// src/lib/aggregate.ts
// Nightly rollup of one completed NZ service day into per-route
// DailyRouteSummary rows and per-route, per-hour HourlyRouteSummary rows, and
// the catch-up rule that picks which days a run covers. The route handler is a thin wrapper so the pipeline, the upsert ops
// and the catch-up choice can be tested as plain functions.
import { prisma, runCommand, throwOnWriteErrors } from "@/lib/db";
import { NO_DELAY_SOURCE, realDeviationExprFor } from "@/lib/deviation";
import { classifyGhosts, type GhostPassResult } from "@/lib/ghost-pass";
import { NZ_TZ } from "@/lib/nz-tz";
import {
  earlyTwoCounts,
  lateSum,
  ON_TIME_LATE_SEC,
  onTimeTwoCounts,
  pickEarlyByRouteMode,
  pickOnTimeByRouteMode,
} from "@/lib/on-time";
import { nzServiceDayRange, shiftWeek, type DateRange } from "@/lib/time";
import type { Prisma } from "@prisma/client";

/** One route's rolled-up day, as the pipeline projects it. */
export interface DailyStats {
  /** Route id. */
  _id: string;
  events: number;
  avg_delay_sec: number;
  avg_abs_delay_sec: number;
  on_time_pct: number;
  early_pct: number;
  late_pct: number;
}

/** What one day's rollup did, for the ingest log. */
export interface AggregateDayResult {
  /** Routes summarised. */
  aggregated: number;
  /** Route-hours summarised, or null when the hourly rollup failed. */
  hourly: number | null;
  ghosts: GhostPassResult;
}

/**
 * Earlier completed days a default run also covers, beyond yesterday. Bounded so
 * a run that must catch up after an outage still fits one function invocation;
 * a longer gap closes over successive nights, oldest days first.
 */
export const CATCH_UP_EXTRA_DAYS = 2;

/**
 * The aggregation that rolls a service day up per route. The initial `$match`
 * carries no deviation filter, so every event contributes to the `events`
 * count and a route with ghost readings is not pushed below the rankings
 * threshold. Everything computed from the readings - the averages and all three
 * rates - counts only the real ones through the same `$cond` guard, and divides
 * by the real-reading count rather than by `events`, so a run the nightly pass
 * hid cannot move a route's on-time figure. With the day classified (its ghost
 * pass has just run) the guard drops the magnitude bound, so a genuine
 * three-hour delay counts.
 * Routes missing from the static Route collection (seen in realtime before the
 * nightly GTFS sync catches up) are kept with a bare `$unwind` that preserves
 * empties; their on-time pick falls through to the strict (bus) rule.
 * @param range - The service-day window, half-open like every other read.
 * @param classified - Whether the day's ghost pass has run.
 * @returns The pipeline stages.
 */
export function dailySummaryPipeline(
  range: DateRange,
  classified: boolean,
): Prisma.InputJsonObject[] {
  const plausible = realDeviationExprFor(classified);
  return [
    {
      $match: {
        scheduledAt: {
          $gte: { $date: range.start.toISOString() },
          $lt: { $date: range.end.toISOString() },
        },
        // Loose-mode rows carry no delay and store deviationSec 0; they would
        // read as perfectly on-time arrivals that were never observed.
        source: { $ne: NO_DELAY_SOURCE },
      },
    },
    {
      $group: {
        _id: "$routeId",
        events: { $sum: 1 },
        // Real-reading count, the denominator for the delay averages.
        _plausible: { $sum: { $cond: [plausible, 1, 0] } },
        w_delay: { $sum: { $cond: [plausible, "$deviationSec", 0] } },
        w_abs: { $sum: { $cond: [plausible, { $abs: "$deviationSec" }, 0] } },
        ...onTimeTwoCounts(plausible),
        ...earlyTwoCounts(plausible),
        late_count: lateSum(plausible),
      },
    },
    { $lookup: { from: "Route", localField: "_id", foreignField: "_id", as: "route" } },
    { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },
    { $addFields: { on_time_count: pickOnTimeByRouteMode, early_count: pickEarlyByRouteMode } },
    {
      $addFields: {
        avg_delay_sec: { $divide: ["$w_delay", { $max: [1, "$_plausible"] }] },
        avg_abs_delay_sec: { $divide: ["$w_abs", { $max: [1, "$_plausible"] }] },
        on_time_pct: {
          $multiply: [{ $divide: ["$on_time_count", { $max: [1, "$_plausible"] }] }, 100],
        },
        early_pct: {
          $multiply: [{ $divide: ["$early_count", { $max: [1, "$_plausible"] }] }, 100],
        },
        late_pct: { $multiply: [{ $divide: ["$late_count", { $max: [1, "$_plausible"] }] }, 100] },
      },
    },
    {
      $project: {
        _id: 1,
        events: 1,
        avg_delay_sec: 1,
        avg_abs_delay_sec: 1,
        on_time_pct: 1,
        early_pct: 1,
        late_pct: 1,
      },
    },
  ];
}

/**
 * The bulk-update entries that store a day's rows, keyed on `(routeId, date)`
 * and upserted so overlapping runs on the same day stay safe (each entry is
 * atomic per document).
 * @param stats - The pipeline's rows.
 * @param dayStart - The service day's start, the stored `date`.
 * @param thresholdSec - The late bound the on-time rates were computed with, stored beside them.
 * @returns The update entries.
 */
export function summaryUpsertOps(
  stats: readonly DailyStats[],
  dayStart: Date,
  thresholdSec: number,
): Prisma.InputJsonObject[] {
  const dateBson = { $date: dayStart.toISOString() };
  return stats.map((stat) => ({
    q: { routeId: stat._id, date: dateBson },
    u: {
      $set: {
        routeId: stat._id,
        date: dateBson,
        events: stat.events,
        avgDelaySec: stat.avg_delay_sec,
        avgAbsDelaySec: stat.avg_abs_delay_sec,
        onTimePct: stat.on_time_pct,
        earlyPct: stat.early_pct,
        latePct: stat.late_pct,
        thresholdSec,
      },
    },
    upsert: true,
  }));
}

/** One route's rolled-up hour, as {@link hourlySummaryPipeline} projects it. */
export interface HourlyStats {
  _id: {
    routeId: string;
    /** Auckland clock hour of the scheduled arrival, 0-23. */
    hour: number;
  };
  events: number;
  /** Real readings, the denominator for every figure below. */
  plausible: number;
  /** Sum of the real readings' signed deviation, in seconds. */
  sum_delay: number;
  /** Sum of the real readings' absolute deviation, in seconds. */
  sum_abs: number;
  on_time: number;
  early: number;
  late: number;
}

/**
 * The aggregation that rolls a service day up per route and per Auckland clock
 * hour, for the time-of-day filters on long windows. It counts exactly what
 * {@link dailySummaryPipeline} counts, but stores the counts and sums rather
 * than the rates: hours are added together at read time, and a sum of rates
 * would need the denominators back. The on-time and early counts are already
 * picked by mode here, so a reader needs no route lookup to add them up.
 * @param range - The service-day window.
 * @param classified - Whether the day's ghost pass has run.
 * @returns The pipeline stages.
 */
export function hourlySummaryPipeline(
  range: DateRange,
  classified: boolean,
): Prisma.InputJsonObject[] {
  const plausible = realDeviationExprFor(classified);
  return [
    {
      $match: {
        scheduledAt: {
          $gte: { $date: range.start.toISOString() },
          $lt: { $date: range.end.toISOString() },
        },
        source: { $ne: NO_DELAY_SOURCE },
      },
    },
    {
      $group: {
        _id: {
          routeId: "$routeId",
          hour: { $hour: { date: "$scheduledAt", timezone: NZ_TZ } },
        },
        events: { $sum: 1 },
        plausible: { $sum: { $cond: [plausible, 1, 0] } },
        sum_delay: { $sum: { $cond: [plausible, "$deviationSec", 0] } },
        sum_abs: { $sum: { $cond: [plausible, { $abs: "$deviationSec" }, 0] } },
        ...onTimeTwoCounts(plausible),
        ...earlyTwoCounts(plausible),
        late: lateSum(plausible),
      },
    },
    { $lookup: { from: "Route", localField: "_id.routeId", foreignField: "_id", as: "route" } },
    { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        events: 1,
        plausible: 1,
        sum_delay: 1,
        sum_abs: 1,
        on_time: pickOnTimeByRouteMode,
        early: pickEarlyByRouteMode,
        late: 1,
      },
    },
  ];
}

/**
 * The bulk-update entries that store a day's hourly rows, keyed on
 * `(routeId, date, hour)` and upserted like {@link summaryUpsertOps}.
 * @param stats - The hourly pipeline's rows.
 * @param dayStart - The service day's start, the stored `date`.
 * @param thresholdSec - The late bound the counts were taken with, stored beside them.
 * @returns The update entries.
 */
export function hourlyUpsertOps(
  stats: readonly HourlyStats[],
  dayStart: Date,
  thresholdSec: number,
): Prisma.InputJsonObject[] {
  const dateBson = { $date: dayStart.toISOString() };
  return stats.map((stat) => ({
    q: { routeId: stat._id.routeId, date: dateBson, hour: stat._id.hour },
    u: {
      $set: {
        routeId: stat._id.routeId,
        date: dateBson,
        hour: stat._id.hour,
        events: stat.events,
        plausible: stat.plausible,
        sumDelaySec: stat.sum_delay,
        sumAbsDelaySec: stat.sum_abs,
        onTime: stat.on_time,
        early: stat.early,
        late: stat.late,
        thresholdSec,
      },
    },
    upsert: true,
  }));
}

/**
 * The indexes HourlyRouteSummary needs, created by the writer itself so the
 * collection works before a schema push. The names are the ones Prisma gives
 * the model's `@@unique` and `@@index`, so a later `db push` finds them in place
 * rather than failing on a second index over the same keys.
 */
export const HOURLY_SUMMARY_INDEXES: Prisma.InputJsonObject = {
  createIndexes: "HourlyRouteSummary",
  indexes: [
    {
      key: { routeId: 1, date: 1, hour: 1 },
      name: "HourlyRouteSummary_routeId_date_hour_key",
      unique: true,
    },
    { key: { date: 1 }, name: "HourlyRouteSummary_date_idx" },
  ],
};

/**
 * Roll one service day up by route and hour and upsert the rows. Run after the
 * day's ghost pass (so `classified` holds); the backfill script calls it alone
 * for days whose daily rollup already exists.
 * @param range - The service-day window.
 * @returns How many route-hours were written.
 */
export async function writeHourlySummary(range: DateRange): Promise<number> {
  const result = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: hourlySummaryPipeline(range, true),
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as { cursor: { firstBatch: HourlyStats[] } };
  const stats = result.cursor.firstBatch;
  if (stats.length === 0) return 0;
  // A no-op once the indexes exist; without the unique one every upsert below
  // would scan the collection to find its row.
  await runCommand(() => prisma.$runCommandRaw(HOURLY_SUMMARY_INDEXES));
  const reply = await runCommand(() =>
    prisma.$runCommandRaw({
      update: "HourlyRouteSummary",
      updates: hourlyUpsertOps(stats, range.start, ON_TIME_LATE_SEC),
      ordered: false,
    }),
  );
  throwOnWriteErrors(reply, [], "HourlyRouteSummary upsert");
  return stats.length;
}

/**
 * The service dates a default run covers, oldest first: yesterday always, plus
 * each of the {@link CATCH_UP_EXTRA_DAYS} days before it that has arrival events
 * but no summary yet. A day an earlier run already rolled up is left alone, and
 * a day with no events (a purge, or retention) is nothing to catch up.
 * @param yesterday - The most recently completed service date (`YYYY-MM-DD`).
 * @param hasSummary - Whether a date already has a `DailyRouteSummary`.
 * @param hasEvents - Whether a date has any arrival events.
 * @param extraDays - How many earlier days to consider.
 * @returns The dates to aggregate, oldest first.
 */
export function catchUpDates(
  yesterday: string,
  hasSummary: (date: string) => boolean,
  hasEvents: (date: string) => boolean,
  extraDays = CATCH_UP_EXTRA_DAYS,
): string[] {
  const dates: string[] = [];
  for (let back = extraDays; back >= 1; back--) {
    const date = shiftWeek(yesterday, -back);
    if (!hasSummary(date) && hasEvents(date)) dates.push(date);
  }
  dates.push(yesterday);
  return dates;
}

/**
 * Whether a service date already has at least one summary row. A range match,
 * as every other summary read is: the stored `date` is a service-day start
 * instant, and an equality match breaks the moment the boundary hour moves
 * while stored stamps still carry the old one. Each stored day lands in exactly
 * one window under both a 5am and a 4am rule, so this read is indifferent to
 * which hour wrote the stamp.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns True when the day was rolled up before.
 */
export async function daySummarised(date: string): Promise<boolean> {
  const { start, end } = nzServiceDayRange(date);
  const row = await prisma.dailyRouteSummary.findFirst({
    where: { date: { gte: start, lt: end } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Whether a service date holds any arrival events.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns True when at least one event falls in the day.
 */
export async function dayHasEvents(date: string): Promise<boolean> {
  const { start, end } = nzServiceDayRange(date);
  const row = await prisma.arrivalEvent.findFirst({
    where: { scheduledAt: { gte: start, lt: end } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Roll one completed service day up: classify its ghosts, run the pipeline and
 * upsert the rows, then write the hourly rows. A ghost-pass failure throws out
 * of here and so fails the day, leaving it unsummarised for the next run's
 * catch-up to retry; rolling it up unclassified would pin the noise into the
 * archive for good. An hourly failure is logged and the day still counts as
 * done: readers scan a day with no hourly rows live, so the gap costs speed,
 * not correctness, and it must not hold back the daily rollup every page reads.
 * @param range - The service-day window.
 * @param serviceDate - Its service date (`YYYY-MM-DD`), for the log and for the
 *   ghost pass's record of any run it hides.
 * @returns Routes and route-hours summarised, and the ghost pass's counts.
 */
export async function aggregateDay(
  range: DateRange,
  serviceDate: string,
): Promise<AggregateDayResult> {
  console.log("[AGGREGATE] Starting", {
    date: serviceDate,
    start: range.start.toISOString(),
    end: range.end.toISOString(),
  });

  const ghosts = await classifyGhosts(range, serviceDate);
  console.log("[AGGREGATE] Ghost pass complete", { date: serviceDate, ...ghosts });

  const result = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: dailySummaryPipeline(range, true),
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as { cursor: { firstBatch: DailyStats[] } };
  const stats = result.cursor.firstBatch;

  if (stats.length > 0) {
    const reply = await runCommand(() =>
      prisma.$runCommandRaw({
        update: "DailyRouteSummary",
        updates: summaryUpsertOps(stats, range.start, ON_TIME_LATE_SEC),
        ordered: false,
      }),
    );
    throwOnWriteErrors(reply, [], "DailyRouteSummary upsert");
  }

  let hourly: number | null = null;
  try {
    hourly = await writeHourlySummary(range);
  } catch (error) {
    console.error("[AGGREGATE] Hourly rollup failed", {
      date: serviceDate,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { aggregated: stats.length, hourly, ghosts };
}
