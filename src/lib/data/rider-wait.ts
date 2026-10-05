// src/lib/data/rider-wait.ts
// The rider-wait penalty of each service day's cancellations (lib/rider-wait.ts),
// read for the routes that had one: their runs give the gap to the next trip and
// the usual stop count. Cached under the day, so a week or month reuses each day.
import { cachedForDay, dayEntryRevalidate, windowEnd } from "@/lib/data/cache";
import { getNetworkCancelledTrips } from "@/lib/data/cancelled";
import { aggregateRows, dateWindow, toIso } from "@/lib/data/raw";
import { LIVE_DAY_REVALIDATE } from "@/lib/data/revalidate";
import { routeIdsForSlug } from "@/lib/data/routes";
import { realDeviationMatchFor } from "@/lib/deviation";
import {
  addPenalties,
  penaltiesInHours,
  riderWaitPenalties,
  type DayFlag,
  type DayRun,
  type FlaggedTripPenalty,
  type Penalty,
  type TripPenalty,
} from "@/lib/rider-wait";
import { routeSlug } from "@/lib/route/slug";
import {
  nzServiceDayRange,
  nzServiceDayString,
  serviceDatesInRange,
  type DateRange,
} from "@/lib/time/service-day";
import type { HourRange } from "@/lib/time/time-of-day";

/** One service day's penalties. */
export interface DayRiderWait {
  /** Route slug to what its cancellations add. */
  routes: Record<string, Penalty>;
  /** Trip id to what the flagged trip adds. */
  trips: Record<string, FlaggedTripPenalty>;
}

/** A run as the day's aggregation returns it. */
interface RunRaw {
  _id: string;
  routeId: string;
  start: { $date: string } | string;
  stops: number;
  direction: number | null;
}

/**
 * One service day's penalties. Only the routes with a flagged trip are scanned,
 * on the `(routeId, scheduledAt)` index. The TTL is part of the key (see
 * {@link dayEntryRevalidate}).
 * @param date - Service date (`YYYY-MM-DD`).
 * @param revalidate - TTL in seconds while the day can still change.
 * @returns The day's penalties.
 */
function riderWaitOfDay(date: string, revalidate: number): Promise<DayRiderWait> {
  const range = nzServiceDayRange(date);
  return cachedForDay(
    async (classified) => {
      // Nested on purpose: here the day's cancellations skip their cache read, one
      // small query per miss of this entry. Read outside, they would cost a Data
      // Cache read for every day of every window on each request, hits included.
      const cancelled = await getNetworkCancelledTrips(range);
      // A cancellation is charged only once its scheduled departure has passed.
      // The arrivals it is weighed against stop at the same instant
      // (scheduledAtWindow clips an open day to now), so counting a trip
      // cancelled for 6pm at 10am this morning put late visits in the numerator
      // while this evening's arrivals were correctly absent from the
      // denominator. The live figure was dragged down early and recovered
      // through the day, beyond any real change in the service.
      //
      // A flag with no scheduled start is kept: there is nothing to compare, and
      // dropping it would lose a real cancellation rather than defer it.
      const chargeableBefore = windowEnd(range).getTime();
      const flagged = cancelled.filter(
        (c) =>
          c.stage !== "ran" &&
          (c.scheduled_start == null || Date.parse(c.scheduled_start) < chargeableBefore),
      );
      if (flagged.length === 0) return { routes: {}, trips: {} };
      const slugs = [...new Set(flagged.map((c) => c.slug))];
      const routeIds = (await Promise.all(slugs.map(routeIdsForSlug))).flat();
      const res = await aggregateRows<RunRaw>("ArrivalEvent", [
        {
          $match: {
            routeId: { $in: routeIds },
            scheduledAt: dateWindow(range),
            ...realDeviationMatchFor(classified),
          },
        },
        {
          $group: {
            _id: "$tripId",
            routeId: { $first: "$routeId" },
            start: { $min: "$scheduledAt" },
            stopSet: { $addToSet: "$stopId" },
          },
        },
        { $lookup: { from: "tripMeta", localField: "_id", foreignField: "_id", as: "meta" } },
        {
          $project: {
            routeId: 1,
            start: 1,
            stops: { $size: "$stopSet" },
            direction: { $ifNull: [{ $first: "$meta.directionId" }, null] },
          },
        },
      ]);
      const runs: DayRun[] = res.map((r) => ({
        tripId: r._id,
        route: routeSlug(r.routeId),
        direction: r.direction,
        start: Date.parse(toIso(r.start)),
        stops: r.stops,
      }));
      const flags: DayFlag[] = flagged.map((c) => ({
        tripId: c.trip_id,
        route: c.slug,
        direction: c.direction_id,
        start: c.scheduled_start ? Date.parse(c.scheduled_start) : null,
        stage: c.stage,
      }));
      return riderWaitPenalties(runs, flags);
    },
    ["rider-wait-v2", date, String(revalidate)],
    date,
    revalidate,
  );
}

/**
 * What cancellations add to each route's figures over a window, summed across
 * its service days. Days that have not started are skipped.
 * @param range - The window.
 * @param revalidate - The caller's TTL, which today's entry follows when shorter.
 * @returns Route slug to its penalty.
 */
export function getRouteRiderWait(
  range: DateRange,
  revalidate: number = LIVE_DAY_REVALIDATE,
): Promise<Record<string, Penalty>> {
  return getRiderWaitOfDates(serviceDatesInRange(range), null, revalidate);
}

/**
 * What cancellations add to each route's figures over a set of service days,
 * optionally only those of trips due to start in a part of the day. Days that
 * have not started are skipped.
 * @param dates - Service dates (`YYYY-MM-DD`).
 * @param hours - The part of the day, or null for all of it.
 * @param revalidate - The caller's TTL, which today's entry follows when shorter.
 * @returns Route slug to its penalty.
 */
export async function getRiderWaitOfDates(
  dates: readonly string[],
  hours: HourRange | null,
  revalidate: number = LIVE_DAY_REVALIDATE,
): Promise<Record<string, Penalty>> {
  const now = new Date();
  const today = nzServiceDayString(now);
  const started = dates.filter((d) => nzServiceDayRange(d).start <= now);
  const days = await Promise.all(
    started.map((d) => riderWaitOfDay(d, dayEntryRevalidate(d, revalidate, today))),
  );
  const out: Record<string, Penalty> = {};
  for (const day of days) {
    const routes = hours ? penaltiesInHours(day.trips, hours) : day.routes;
    for (const [slug, p] of Object.entries(routes)) {
      out[slug] = out[slug] ? addPenalties(out[slug], p) : p;
    }
  }
  return out;
}

/**
 * What each flagged trip adds on one service day, for the route trip board.
 * @param range - The service-day window.
 * @returns Trip id to its penalty.
 */
export async function getTripRiderWait(range: DateRange): Promise<Record<string, TripPenalty>> {
  const [date] = serviceDatesInRange(range);
  return date
    ? (await riderWaitOfDay(date, dayEntryRevalidate(date, LIVE_DAY_REVALIDATE))).trips
    : {};
}
