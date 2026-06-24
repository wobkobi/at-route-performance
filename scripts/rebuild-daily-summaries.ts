/**
 * Rebuild DailyRouteSummary for the given NZ service dates by running the
 * aggregate pipeline directly (no HTTP round-trip). Uses batchSize:100_000 so
 * all routes are captured, fixing the cursor-truncation bug where only the
 * first 101 routes were processed per run.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/rebuild-daily-summaries.ts 2026-06-19 2026-06-20 ...
 *   (no args = last 7 completed NZ service days)
 */
import { MAX_EARLY_SEC, MAX_LATE_SEC } from "@/lib/deviation";
import {
  earlyTwoCounts,
  lateSum,
  ON_TIME_LATE_SEC,
  onTimeTwoCounts,
  pickEarlyByRouteMode,
  pickOnTimeByRouteMode,
} from "@/lib/on-time";
import { nzServiceDayRange, nzServiceDayString } from "@/lib/time";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

// Parse date args or fall back to last 7 completed service days.
const args = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const dates: string[] =
  args.length > 0
    ? args
    : Array.from({ length: 7 }, (_, i) => {
        // i=0 = yesterday (last completed day), i=6 = 7 days ago
        const d = new Date(Date.now() - (i + 1) * 86_400_000);
        return nzServiceDayString(d);
      }).reverse();

console.log(
  `Rebuilding DailyRouteSummary for ${dates.length} service day(s):\n  ${dates.join(", ")}\n`,
);

const thresholdSec = parseInt(process.env.ON_TIME_THRESHOLD_SEC || String(ON_TIME_LATE_SEC), 10);

const plausible = {
  $and: [{ $gte: ["$deviationSec", -MAX_EARLY_SEC] }, { $lte: ["$deviationSec", MAX_LATE_SEC] }],
};

let ok = 0;
let failed = 0;

for (const dateStr of dates) {
  const range = nzServiceDayRange(dateStr);
  const dateBson = { $date: range.start.toISOString() };

  try {
    const result = (await p.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: [
        {
          $match: {
            scheduledAt: {
              $gte: { $date: range.start.toISOString() },
              $lt: { $date: range.end.toISOString() },
            },
            source: { $ne: "AT_GTFSRT_NO_DELAY" },
          },
        },
        {
          $group: {
            _id: "$routeId",
            events: { $sum: 1 },
            _plausible: { $sum: { $cond: [plausible, 1, 0] } },
            w_delay: { $sum: { $cond: [plausible, "$deviationSec", 0] } },
            w_abs: { $sum: { $cond: [plausible, { $abs: "$deviationSec" }, 0] } },
            ...onTimeTwoCounts(),
            ...earlyTwoCounts(),
            late_count: lateSum(),
            _delays: { $push: "$deviationSec" },
          },
        },
        { $lookup: { from: "Route", localField: "_id", foreignField: "_id", as: "route" } },
        { $unwind: "$route" },
        { $addFields: { on_time_count: pickOnTimeByRouteMode, early_count: pickEarlyByRouteMode } },
        {
          $addFields: {
            _ok: {
              $filter: {
                input: "$_delays",
                as: "d",
                cond: {
                  $and: [{ $gte: ["$$d", -MAX_EARLY_SEC] }, { $lte: ["$$d", MAX_LATE_SEC] }],
                },
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
      // Large batch size so all routes fit in the first batch (default of 101
      // would silently truncate the result to the first 101 routes).
      cursor: { batchSize: 100_000 },
    })) as unknown as {
      cursor: {
        firstBatch: {
          _id: string;
          events: number;
          avg_delay_sec: number;
          avg_abs_delay_sec: number;
          on_time_pct: number;
          early_pct: number;
          late_pct: number;
          p50_delay_sec?: number;
          p95_delay_sec?: number;
        }[];
      };
    };

    const stats = result.cursor.firstBatch;

    if (stats.length === 0) {
      console.log(`  ${dateStr}  (no events - skipped)`);
      continue;
    }

    await p.$runCommandRaw({
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
            p50DelaySec: stat.p50_delay_sec ?? null,
            p95DelaySec: stat.p95_delay_sec ?? null,
            thresholdSec,
          },
        },
        upsert: true,
      })),
      ordered: false,
    });

    const totalEvents = stats.reduce((s, r) => s + r.events, 0);
    console.log(
      `  ${dateStr}  ok  (${stats.length} routes, ${totalEvents.toLocaleString()} events)`,
    );
    ok++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ${dateStr}  FAILED: ${msg}`);
    failed++;
  }
}

console.log(`\n${ok} succeeded, ${failed} failed`);
await p.$disconnect();
