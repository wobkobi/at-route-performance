// src/lib/aggregate.ts
// Nightly rollup of one completed NZ service day into per-route
// DailyRouteSummary rows, and the catch-up rule that picks which days a run
// covers. The route handler is a thin wrapper so the pipeline, the upsert ops
// and the catch-up choice can be tested as plain functions.
import { prisma, runCommand, throwOnWriteErrors } from "@/lib/db";
import { NO_DELAY_SOURCE, realDeviationExprFor } from "@/lib/deviation";
import { classifyGhosts, type GhostPassResult } from "@/lib/ghost-pass";
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
 * threshold; the averages and on-time rates count only the real readings
 * through `$cond` guards. With the day classified (its ghost pass has just run)
 * the guards drop the magnitude bound, so a genuine three-hour delay counts.
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
        ...onTimeTwoCounts(),
        ...earlyTwoCounts(),
        late_count: lateSum(),
      },
    },
    { $lookup: { from: "Route", localField: "_id", foreignField: "_id", as: "route" } },
    { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },
    { $addFields: { on_time_count: pickOnTimeByRouteMode, early_count: pickEarlyByRouteMode } },
    {
      $addFields: {
        avg_delay_sec: { $divide: ["$w_delay", { $max: [1, "$_plausible"] }] },
        avg_abs_delay_sec: { $divide: ["$w_abs", { $max: [1, "$_plausible"] }] },
        on_time_pct: { $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] },
        early_pct: { $multiply: [{ $divide: ["$early_count", "$events"] }, 100] },
        late_pct: { $multiply: [{ $divide: ["$late_count", "$events"] }, 100] },
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
 * upsert the rows. A ghost-pass failure throws out of here and so fails the
 * day, leaving it unsummarised for the next run's catch-up to retry; rolling it
 * up unclassified would pin the noise into the archive for good.
 * @param range - The service-day window.
 * @param serviceDate - Its service date (`YYYY-MM-DD`), for the log and for the
 *   ghost pass's record of any run it hides.
 * @returns Routes summarised and the ghost pass's counts.
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

  return { aggregated: stats.length, ghosts };
}
