// src/lib/cron/trip-punctuality.ts
// Nightly per-route tallies of AT's trip measures (lib/trip/punctuality.ts) for one completed
// service day, stored on the day's DailyRouteSummary rows beside the arrival figures.
import { flagKey, flagStages } from "@/lib/data/flag-stages";
import { aggregateRows, dateWindow, toIso, type BsonDate } from "@/lib/data/raw";
import { prisma, runCommand, throwOnWriteErrors } from "@/lib/db";
import { nzServiceDayRange, serviceDayScanRange } from "@/lib/time/service-day";
import type { CancellationStage } from "@/lib/trip/cancellation";
import {
  addVerdict,
  emptyCounts,
  judgeTrip,
  type EndReading,
  type PunctualityCounts,
} from "@/lib/trip/punctuality";
import type { Prisma } from "@prisma/client";

/** One trip's readings at its ends, as {@link tripEndsPipeline} projects them. */
export interface TripEndsRow {
  /** Trip id. */
  _id: string;
  routeId: string;
  starts: string[];
  last: string;
  r: { s: string; t: BsonDate; d: number }[];
}

/** A cancellation flag with the stage its trip reached. */
export interface StagedFlag {
  tripId: string;
  routeId: string;
  stage: CancellationStage;
}

/**
 * The aggregation that gathers each trip's real readings at its opening and last stops for
 * one service day. Bounded by the day's scan window (the day plus the run tail) and matched on
 * the stamped service date, so a run crossing the boundary hour is read whole and once. Only
 * trips whose TripMeta carries stop ends survive; the rest are readings at stops in between,
 * dropped on the server so the reply stays small.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns The pipeline stages.
 */
export function tripEndsPipeline(date: string): object[] {
  return [
    {
      $match: {
        scheduledAt: dateWindow(serviceDayScanRange(date)),
        serviceDate: date,
        source: "AT_GTFSRT",
        ghost: { $ne: true },
      },
    },
    {
      $group: {
        _id: "$tripId",
        routeId: { $first: "$routeId" },
        r: { $push: { s: "$stopId", t: "$scheduledAt", d: "$deviationSec" } },
      },
    },
    { $lookup: { from: "tripMeta", localField: "_id", foreignField: "_id", as: "m" } },
    { $unwind: "$m" },
    { $match: { "m.lastStopId": { $type: "string" } } },
    {
      $project: {
        routeId: 1,
        starts: "$m.startStopIds",
        last: "$m.lastStopId",
        r: {
          $filter: {
            input: "$r",
            cond: {
              $or: [
                { $in: ["$$this.s", "$m.startStopIds"] },
                { $eq: ["$$this.s", "$m.lastStopId"] },
              ],
            },
          },
        },
      },
    },
  ];
}

/**
 * Tally each route's trips. A trip that never ran or was cut short counts once, as a
 * cancellation, whatever it recorded before the flag; a reinstated one is judged like any other.
 * @param trips - The day's trips with their end readings.
 * @param flags - The day's cancellation flags with their stages.
 * @returns Counts per route id.
 */
export function routePunctuality(
  trips: readonly TripEndsRow[],
  flags: readonly StagedFlag[],
): Map<string, PunctualityCounts> {
  const out = new Map<string, PunctualityCounts>();
  /**
   * A route's tally, started on first use.
   * @param routeId - Route id.
   * @returns The tally.
   */
  const countsFor = (routeId: string): PunctualityCounts => {
    let c = out.get(routeId);
    if (!c) out.set(routeId, (c = emptyCounts()));
    return c;
  };
  const failed = new Set<string>();
  for (const f of flags) {
    if (f.stage === "ran") continue;
    failed.add(f.tripId);
    countsFor(f.routeId).cancelled++;
  }
  for (const t of trips) {
    if (failed.has(t._id)) continue;
    const readings: EndReading[] = t.r.map((r) => ({
      stopId: r.s,
      scheduledMs: Date.parse(toIso(r.t)),
      deviationSec: r.d,
    }));
    addVerdict(
      countsFor(t.routeId),
      judgeTrip(readings, { startStopIds: t.starts, lastStopId: t.last }),
    );
  }
  return out;
}

/**
 * The bulk-update entries that store each route's tallies on its existing summary row. A
 * window match on `date`, as every summary read is, and no upsert: a route with no recorded
 * arrival all day has no row, and a bare row would read as a route that ran with no figures.
 * @param counts - Counts per route id.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns The update entries.
 */
export function punctualityUpdateOps(
  counts: ReadonlyMap<string, PunctualityCounts>,
  date: string,
): Prisma.InputJsonObject[] {
  const window = dateWindow(nzServiceDayRange(date));
  return [...counts].map(([routeId, c]) => ({
    q: { routeId, date: window },
    u: {
      $set: {
        tripsDeparted: c.departed,
        tripsReliable: c.reliable,
        tripsTimed: c.timed,
        tripsPunctual: c.punctual,
        tripsCancelled: c.cancelled,
      },
    },
  }));
}

/**
 * Judge one completed service day's trips and store the tallies on its summary rows. Run
 * after the daily rollup, which writes the rows these update, and after the ghost pass, whose
 * hidden runs the read leaves out.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns How many routes were tallied.
 */
export async function writeTripPunctuality(date: string): Promise<number> {
  const [trips, flagRows] = await Promise.all([
    aggregateRows<TripEndsRow>("ArrivalEvent", tripEndsPipeline(date)),
    prisma.cancelledTrip.findMany({
      where: { serviceDate: date },
      select: { tripId: true, routeId: true, serviceDate: true, detectedAt: true },
    }),
  ]);
  const stages = await flagStages(flagRows);
  const flags = flagRows.map((f) => ({
    tripId: f.tripId,
    routeId: f.routeId,
    stage: stages.get(flagKey(f)) ?? "before",
  }));
  const counts = routePunctuality(trips, flags);
  if (counts.size === 0) return 0;
  const reply = await runCommand(() =>
    prisma.$runCommandRaw({
      update: "DailyRouteSummary",
      updates: punctualityUpdateOps(counts, date),
      ordered: false,
    }),
  );
  throwOnWriteErrors(reply, [], "DailyRouteSummary trip punctuality");
  return counts.size;
}
