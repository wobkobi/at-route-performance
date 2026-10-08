// src/lib/cron/trip-punctuality.ts
// Nightly per-route tallies of AT's trip measures (lib/trip/punctuality.ts) for one completed
// service day, stored one row per route in DailyTripTally.
import { flagKey, flagStages } from "@/lib/data/flag-stages";
import { aggregateRows, dateWindow, toIso, type BsonDate } from "@/lib/data/raw";
import { prisma, runCommand, throwOnWriteErrors } from "@/lib/db";
import {
  nzServiceDayRange,
  serviceDayClockInstant,
  serviceDayScanRange,
} from "@/lib/time/service-day";
import type { CancellationStage } from "@/lib/trip/cancellation";
import { gtfsTimeSeconds, tripIdStartSeconds } from "@/lib/trip/id";
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

/** A stored cancellation flag as the day's read selects it. */
export interface FlagRow {
  tripId: string;
  routeId: string;
  serviceDate: string;
  /** GTFS `HH:MM:SS` start, or null when the flag was stored without one. */
  startTime: string | null;
  detectedAt: Date;
}

/**
 * Where one service day's judging stops: the end of its scan window, or `now` while that
 * window is still open. The readings and the cancellation flags both stop here, so neither
 * side of a share runs ahead of the other.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param now - The present.
 * @returns The earlier of the scan window's end and `now`.
 */
export function judgingCutoff(date: string, now: Date): Date {
  const { end } = serviceDayScanRange(date);
  return end.getTime() > now.getTime() ? now : end;
}

/**
 * The flags whose trips were due to start before the cutoff. A flag on a trip not yet due
 * would count a failure whose matching runs have not had the chance to be read. The start is
 * the flag's own GTFS start time, else the one the trip id encodes. A flag with neither is
 * kept: nothing places it later in the day, and dropping it would lose a real cancellation
 * rather than defer it.
 * @param flags - The day's stored flags.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param cutoff - Where judging stops, from {@link judgingCutoff}.
 * @returns The flags due before the cutoff, in the order given.
 */
export function flagsDueBefore<T extends Pick<FlagRow, "tripId" | "startTime">>(
  flags: readonly T[],
  date: string,
  cutoff: Date,
): T[] {
  const dayStart = nzServiceDayRange(date).start;
  return flags.filter((f) => {
    const sec = gtfsTimeSeconds(f.startTime) ?? tripIdStartSeconds(f.tripId);
    return sec === null || serviceDayClockInstant(dayStart, sec).getTime() < cutoff.getTime();
  });
}

/**
 * The aggregation that gathers each trip's real readings at its opening and last stops for
 * one service day. Bounded by the day's scan window (the day plus the run tail) and matched on
 * the stamped service date, so a run crossing the boundary hour is read whole and once. Only
 * trips whose TripMeta carries stop ends survive; the rest are readings at stops in between,
 * dropped on the server so the reply stays small.
 *
 * The read keeps only readings whose time has passed: the window stops at
 * {@link judgingCutoff}, and each reading's `actualAt` must be before `now`. Ingest stores
 * AT's predicted time at every stop the vehicle has not reached yet, including stops whose
 * scheduled time is already behind it, and judging an unfinished window on a prediction would
 * count a guess. This covers today and, until the run tail ends three hours past the
 * boundary, yesterday's tail too; once the scan window has passed, as it has by the nightly
 * run, the clip changes nothing.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param now - The present, injectable for tests.
 * @returns The pipeline stages.
 */
export function tripEndsPipeline(date: string, now: Date = new Date()): object[] {
  const { start } = serviceDayScanRange(date);
  return [
    {
      $match: {
        scheduledAt: dateWindow({ start, end: judgingCutoff(date, now) }),
        actualAt: { $lt: { $date: now.toISOString() } },
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
 * A cancellation counts only when its trip has stop ends, the same test the running trips pass
 * in {@link tripEndsPipeline}: a trip with none could never have been judged had it run, so
 * counting its cancellation would add a failure with no matching success. The trip is still
 * left out of the judged runs either way.
 * @param trips - The day's trips with their end readings.
 * @param flags - The day's cancellation flags with their stages.
 * @param judgeable - Ids of the flagged trips whose TripMeta carries stop ends.
 * @returns Counts per route id.
 */
export function routePunctuality(
  trips: readonly TripEndsRow[],
  flags: readonly StagedFlag[],
  judgeable: ReadonlySet<string>,
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
    if (judgeable.has(f.tripId)) countsFor(f.routeId).cancelled++;
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
 * The route id of the row that marks a day's tallies as complete. The writer stores it last,
 * after every route's row has landed, so a write that fails part way leaves the day unmarked
 * and the readers judge it live rather than trusting half a day. It also marks a day judged
 * with nothing to tally, which would otherwise look never judged.
 */
export const DAY_MARKER = "*";

/**
 * The indexes DailyTripTally needs, created by the writer itself so the collection works
 * before a schema push. The names are the ones Prisma gives the model's `@@unique` and
 * `@@index`, so a later `db push` finds them in place rather than failing on a second
 * index over the same keys.
 */
export const TRIP_TALLY_INDEXES: Prisma.InputJsonObject = {
  createIndexes: "DailyTripTally",
  indexes: [
    { key: { routeId: 1, date: 1 }, name: "DailyTripTally_routeId_date_key", unique: true },
    { key: { date: 1 }, name: "DailyTripTally_date_idx" },
  ],
};

/**
 * The bulk-upsert entries that store each route's tallies for one day, keyed on the route and
 * the exact service-day start, so a re-run replaces a route's row rather than adding to it. A
 * route with only cancellations gets a row too, which is why these are not on DailyRouteSummary.
 * @param counts - Counts per route id.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns The update entries.
 */
export function tripTallyUpsertOps(
  counts: ReadonlyMap<string, PunctualityCounts>,
  date: string,
): Prisma.InputJsonObject[] {
  const dateBson = { $date: nzServiceDayRange(date).start.toISOString() };
  return [...counts].map(([routeId, c]) => ({
    q: { routeId, date: dateBson },
    u: {
      $set: {
        routeId,
        date: dateBson,
        departed: c.departed,
        reliable: c.reliable,
        timed: c.timed,
        punctual: c.punctual,
        cancelled: c.cancelled,
      },
    },
    upsert: true,
  }));
}

/**
 * The delete entry that clears a day's rows for routes this run did not tally, so a re-run
 * that judges fewer routes (a flag lifted, a ghost run hidden) leaves no stale row behind.
 * The {@link DAY_MARKER} row goes too, until the run stores it again at the end. Matched on
 * the day's window, as every read of the collection is.
 * @param routeIds - The routes this run tallied.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns The delete entry.
 */
export function staleTallyDelete(
  routeIds: readonly string[],
  date: string,
): Prisma.InputJsonObject {
  return {
    q: { date: dateWindow(nzServiceDayRange(date)), routeId: { $nin: [...routeIds] } },
    limit: 0,
  };
}

/**
 * Judge one service day's trips, reading only: the day's end readings and its cancellation
 * flags, staged. Both stop at the same {@link judgingCutoff}, so a live day counts only the
 * cancellations of trips already due. The backfill's dry run prints this without writing.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param now - The present, injectable for tests.
 * @returns Counts per route id.
 */
export async function tripPunctualityOfDay(
  date: string,
  now: Date = new Date(),
): Promise<Map<string, PunctualityCounts>> {
  const [trips, flagRows] = await Promise.all([
    aggregateRows<TripEndsRow>("ArrivalEvent", tripEndsPipeline(date, now)),
    prisma.cancelledTrip.findMany({
      where: { serviceDate: date },
      select: {
        tripId: true,
        routeId: true,
        serviceDate: true,
        startTime: true,
        detectedAt: true,
      },
    }),
  ]);
  const due = flagsDueBefore(flagRows, date, judgingCutoff(date, now));
  // Stop ends are checked in code, not the query: ingest leaves `lastStopId` unset rather
  // than null on a trip without ends, and Prisma's null filters treat unset apart from null.
  const [stages, meta] = await Promise.all([
    flagStages(due),
    due.length === 0
      ? []
      : prisma.tripMeta.findMany({
          where: { id: { in: [...new Set(due.map((f) => f.tripId))] } },
          select: { id: true, lastStopId: true },
        }),
  ]);
  const judgeable = new Set(meta.filter((m) => m.lastStopId != null).map((m) => m.id));
  const flags = due.map((f) => ({
    tripId: f.tripId,
    routeId: f.routeId,
    stage: stages.get(flagKey(f)) ?? "before",
  }));
  return routePunctuality(trips, flags, judgeable);
}

/**
 * Judge one completed service day's trips and store each route's tallies in DailyTripTally,
 * replacing whatever an earlier run stored for the day, then the {@link DAY_MARKER} row once
 * every route's row has landed. Run after the ghost pass, whose hidden runs the read leaves
 * out. A day with nothing to judge stores the marker alone.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns How many routes were tallied.
 */
export async function writeTripPunctuality(date: string): Promise<number> {
  const counts = await tripPunctualityOfDay(date);
  // A no-op once the indexes exist; without the unique one every upsert below would scan
  // the collection to find its row.
  await runCommand(() => prisma.$runCommandRaw(TRIP_TALLY_INDEXES));
  const cleared = await runCommand(() =>
    prisma.$runCommandRaw({
      delete: "DailyTripTally",
      deletes: [staleTallyDelete([...counts.keys()], date)],
    }),
  );
  throwOnWriteErrors(cleared, [], "DailyTripTally clear");
  if (counts.size > 0) {
    const reply = await runCommand(() =>
      prisma.$runCommandRaw({
        update: "DailyTripTally",
        updates: tripTallyUpsertOps(counts, date),
        ordered: false,
      }),
    );
    throwOnWriteErrors(reply, [], "DailyTripTally upsert");
  }
  const marked = await runCommand(() =>
    prisma.$runCommandRaw({
      update: "DailyTripTally",
      updates: tripTallyUpsertOps(new Map([[DAY_MARKER, emptyCounts()]]), date),
    }),
  );
  throwOnWriteErrors(marked, [], "DailyTripTally day marker");
  return counts.size;
}
