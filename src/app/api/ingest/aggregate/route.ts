// src/app/api/ingest/aggregate/route.ts
/**
 * @description Cron-only POST that rolls a completed NZ service day's arrival
 * events into per-route DailyRouteSummary stats. The window matches the live
 * dashboard (5am Auckland, half-open) so numbers line up everywhere. The day's
 * ghost readings are classified first (see lib/ghost-pass.ts) so this rollup and
 * every later read agree on what was real: ghosts still count towards the raw
 * `events` total, so they cannot suppress a route below the rankings threshold,
 * but they are kept out of averages, percentiles and on-time rates. Upserts are
 * keyed on (routeId, date) with ordered:false so overlapping cron runs on the
 * same day stay safe.
 */
import { requireCronAuth } from "@/lib/auth";
import { prisma, runCommand } from "@/lib/db";
import { NO_DELAY_SOURCE, realDeviationExprFor } from "@/lib/deviation";
import { classifyGhosts, type GhostPassResult } from "@/lib/ghost-pass";
import { recordIngestRun } from "@/lib/ingest-run";
import {
  earlyTwoCounts,
  lateSum,
  ON_TIME_LATE_SEC,
  onTimeTwoCounts,
  pickEarlyByRouteMode,
  pickOnTimeByRouteMode,
} from "@/lib/on-time";
import { resolveRequestedDay } from "@/lib/page-nav";
import { nzServiceDayRange, nzServiceDayString, type DateRange } from "@/lib/time";
import { after, NextResponse } from "next/server";

interface DailyStats {
  _id: string; // routeId
  events: number;
  avg_delay_sec: number;
  avg_abs_delay_sec: number;
  on_time_pct: number;
  early_pct: number;
  late_pct: number;
  p50_delay_sec: number;
  p95_delay_sec: number;
}

/**
 * Run the aggregation pipeline and summary upserts, recording the outcome.
 * Invoked via `after` so the 202 response is sent first - a full day can take
 * longer than the external scheduler's 30s request timeout.
 * @param startTime - Epoch ms when the request arrived.
 * @param range - The service-day window to aggregate.
 * @param serviceDate - The window's service date (`YYYY-MM-DD`).
 */
async function runAggregate(
  startTime: number,
  range: DateRange,
  serviceDate: string,
): Promise<void> {
  // Stable BSON-date representation used in both the query filter and the $set.
  const dateBson = { $date: range.start.toISOString() };

  const thresholdSec = parseInt(process.env.ON_TIME_THRESHOLD_SEC || String(ON_TIME_LATE_SEC), 10);

  try {
    console.log("[AGGREGATE] Starting aggregation", {
      date: serviceDate,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      thresholdSec,
    });

    // Classify the day's ghosts before rolling it up, so the summaries below and
    // every later read agree on which readings were real. A failure here must not
    // cost the whole night's rollup: the day stays unclassified and the reads
    // fall back to the wide magnitude guard until the next run.
    let ghosts: GhostPassResult = { trips: 0, flagged: 0 };
    let classified = true;
    try {
      ghosts = await classifyGhosts(range);
      console.log("[AGGREGATE] Ghost pass complete", { date: serviceDate, ...ghosts });
    } catch (error) {
      classified = false;
      console.error("[AGGREGATE] Ghost pass failed; rolling up unclassified", {
        date: serviceDate,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    // The initial $match carries no deviation filter, so every event contributes
    // to the `events` count and a route with ghost readings is not pushed below
    // the rankings threshold. Stats (averages, percentiles, on-time %) count only
    // the real readings, via $filter / $cond guards. The pass above has just
    // flagged the ghosts, so the magnitude guard comes off and a genuine
    // three-hour delay counts; it stays on only when the pass failed.
    const plausible = realDeviationExprFor(classified);
    const result = (await runCommand(() =>
      prisma.$runCommandRaw({
        aggregate: "ArrivalEvent",
        pipeline: [
          {
            $match: {
              // Half-open window: matches nzServiceDayRange used everywhere else.
              scheduledAt: {
                $gte: { $date: range.start.toISOString() },
                $lt: { $date: range.end.toISOString() },
              },
              // Exclude loose-mode rows where no delay was available: these store
              // deviationSec=0 (scheduledAt === actualAt) and would inflate on-time
              // rates if included in averages.
              source: { $ne: NO_DELAY_SOURCE },
              // No deviation filter: every event counted in `events` so ghost
              // readings do not suppress a route's day total.
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
              _delays: { $push: { $cond: [plausible, "$deviationSec", null] } },
            },
          },
          // Resolve the route's mode, then pick the matching on-time + early counts.
          { $lookup: { from: "Route", localField: "_id", foreignField: "_id", as: "route" } },
          // Preserve routes missing from the static Route collection (seen in
          // realtime before the nightly GTFS sync catches up): a bare $unwind
          // would drop their whole day of events. With no route doc the mode
          // picks below fall through to the strict (bus) rule.
          { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },
          {
            $addFields: { on_time_count: pickOnTimeByRouteMode, early_count: pickEarlyByRouteMode },
          },
          {
            // Drop the nulls the ghost guard pushed, leaving the real readings.
            $addFields: {
              _ok: {
                $filter: {
                  input: "$_delays",
                  as: "d",
                  cond: { $ne: ["$$d", null] },
                },
              },
            },
          },
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
              p50_delay_sec: {
                $arrayElemAt: [
                  { $percentile: { input: "$_ok", p: [0.5], method: "approximate" } },
                  0,
                ],
              },
              p95_delay_sec: {
                $arrayElemAt: [
                  { $percentile: { input: "$_ok", p: [0.95], method: "approximate" } },
                  0,
                ],
              },
            },
          },
        ] as never,
        cursor: { batchSize: 100_000 },
      }),
    )) as unknown as { cursor: { firstBatch: DailyStats[] } };

    const stats = result.cursor.firstBatch;

    console.log("[AGGREGATE] Pipeline complete", {
      routesFound: stats.length,
      duration_ms: Date.now() - startTime,
    });

    if (stats.length > 0) {
      // Single bulk update: atomic per document on the (routeId, date) key, no N
      // round-trips, safe when two cron runs overlap on the same service day.
      await runCommand(() =>
        prisma.$runCommandRaw({
          update: "DailyRouteSummary",
          updates: stats.map((stat) => ({
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
                p50DelaySec: stat.p50_delay_sec,
                p95DelaySec: stat.p95_delay_sec,
                thresholdSec,
              },
            },
            upsert: true,
          })),
          ordered: false,
        }),
      );
    }

    const upserted = stats.length;
    const duration = Date.now() - startTime;

    console.log("[AGGREGATE] Complete", {
      timestamp: new Date().toISOString(),
      date: serviceDate,
      aggregated: upserted,
      ghost_trips: ghosts.trips,
      ghost_rows: ghosts.flagged,
      duration_ms: duration,
    });

    await recordIngestRun({
      endpoint: "aggregate",
      startedAt: new Date(startTime),
      success: true,
      count: upserted,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const msg = error instanceof Error ? error.message : "Unknown error";

    console.error("[AGGREGATE] Failed", {
      timestamp: new Date().toISOString(),
      error: msg,
      duration_ms: duration,
    });

    await recordIngestRun({
      endpoint: "aggregate",
      startedAt: new Date(startTime),
      success: false,
      error: msg,
    });
  }
}

/**
 * Compute DailyRouteSummary for all routes on a given NZ service day (defaults to
 * the most recently completed one). The window matches the live dashboard: 5am
 * Auckland to 5am the next day, half-open `[start, end)`. Validates the date,
 * acknowledges, then aggregates after the response; the outcome is recorded in
 * IngestRun and the function logs.
 * @param req - Request with optional `?date=YYYY-MM-DD` query param (treated as
 *   the NZ service date; defaults to the service day that ended before now).
 * @returns 202 JSON `{ started, date }`; 400/401 on bad input.
 */
export function POST(req: Request): NextResponse {
  const startTime = Date.now();

  const denied = requireCronAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const rawDate = url.searchParams.get("date");
  // Calendar-valid check, not just shape: an impossible date (2026-02-31)
  // would silently normalise onto a different service day.
  const dateParam = resolveRequestedDay(rawDate ?? undefined);

  if (rawDate && !dateParam) {
    return NextResponse.json(
      { error: "Invalid date. Use a real YYYY-MM-DD calendar date" },
      { status: 400 },
    );
  }

  // Default to the most recently completed service day (24 h ago is always done).
  const rangeTarget = dateParam ?? new Date(Date.now() - 86_400_000);
  const range = nzServiceDayRange(rangeTarget);
  const serviceDate = nzServiceDayString(range.start);

  after(() => runAggregate(startTime, range, serviceDate));

  return NextResponse.json({ started: true, date: serviceDate }, { status: 202 });
}
