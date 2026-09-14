// src/lib/data/rider-wait.ts
// The rider-wait penalty of each service day's cancellations (lib/rider-wait.ts),
// read for the routes that had one: their runs give the gap to the next trip and
// the usual stop count. Cached under the day, so a week or month reuses each day.
import { cachedForDay, toIso } from "@/lib/data/cache";
import { getNetworkCancelledTrips } from "@/lib/data/cancelled";
import { routeIdsForSlug } from "@/lib/data/routes";
import { prisma, runCommand } from "@/lib/db";
import { realDeviationMatchFor } from "@/lib/deviation";
import {
  addPenalties,
  riderWaitPenalties,
  type DayFlag,
  type DayRun,
  type Penalty,
  type TripPenalty,
} from "@/lib/rider-wait";
import { routeSlug } from "@/lib/route-slug";
import { nzServiceDayRange, serviceDatesInRange, type DateRange } from "@/lib/time";

/** One service day's penalties. */
export interface DayRiderWait {
  /** Route slug to what its cancellations add. */
  routes: Record<string, Penalty>;
  /** Trip id to what the flagged trip adds. */
  trips: Record<string, TripPenalty>;
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
 * on the `(routeId, scheduledAt)` index.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns The day's penalties.
 */
function riderWaitOfDay(date: string): Promise<DayRiderWait> {
  const range = nzServiceDayRange(date);
  return cachedForDay(
    async (classified) => {
      const cancelled = await getNetworkCancelledTrips(range);
      const flagged = cancelled.filter((c) => c.stage !== "ran");
      if (flagged.length === 0) return { routes: {}, trips: {} };
      const slugs = [...new Set(flagged.map((c) => c.route_id))];
      const routeIds = (await Promise.all(slugs.map(routeIdsForSlug))).flat();
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            {
              $match: {
                routeId: { $in: routeIds },
                scheduledAt: {
                  $gte: { $date: range.start.toISOString() },
                  $lt: { $date: range.end.toISOString() },
                },
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
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: RunRaw[] } };
      const runs: DayRun[] = res.cursor.firstBatch.map((r) => ({
        tripId: r._id,
        route: routeSlug(r.routeId),
        direction: r.direction,
        start: Date.parse(toIso(r.start)),
        stops: r.stops,
      }));
      const flags: DayFlag[] = flagged.map((c) => ({
        tripId: c.trip_id,
        route: c.route_id,
        direction: c.direction_id,
        start: c.scheduled_start ? Date.parse(c.scheduled_start) : null,
        stage: c.stage,
      }));
      return riderWaitPenalties(runs, flags);
    },
    ["rider-wait", date],
    date,
    300,
  );
}

/**
 * What cancellations add to each route's figures over a window, summed across
 * its service days. Days that have not started are skipped.
 * @param range - The window.
 * @returns Route slug to its penalty.
 */
export async function getRouteRiderWait(range: DateRange): Promise<Record<string, Penalty>> {
  const now = new Date();
  const dates = serviceDatesInRange(range).filter((d) => nzServiceDayRange(d).start <= now);
  const days = await Promise.all(dates.map(riderWaitOfDay));
  const out: Record<string, Penalty> = {};
  for (const day of days) {
    for (const [slug, p] of Object.entries(day.routes)) {
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
  return date ? (await riderWaitOfDay(date)).trips : {};
}
