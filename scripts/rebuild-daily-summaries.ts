// scripts/rebuild-daily-summaries.ts
// Rebuild DailyRouteSummary for the given NZ service dates by running the
// rollup pipeline directly (no HTTP round-trip). The script does not run the
// ghost pass, so a day it rebuilds may be unclassified and the magnitude guard
// stays on; for a classified rebuild POST /api/ingest/aggregate?date= instead.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/rebuild-daily-summaries.ts 2026-06-19 2026-06-20 ...
//   (no args = last 7 completed NZ service days)
import { dailySummaryPipeline, summaryUpsertOps, type DailyStats } from "@/lib/aggregate";
import { throwOnWriteErrors } from "@/lib/db";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { nzServiceDayRange, nzServiceDayString, shiftWeek } from "@/lib/time";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

// Parse date args or fall back to the last 7 completed service days, stepped by
// service date so a DST switch inside the range cannot skip or repeat a day.
const args = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const today = nzServiceDayString();
const dates: string[] =
  args.length > 0 ? args : Array.from({ length: 7 }, (_, i) => shiftWeek(today, i - 7));

console.log(
  `Rebuilding DailyRouteSummary for ${dates.length} service day(s):\n  ${dates.join(", ")}\n`,
);

let ok = 0;
let failed = 0;

for (const dateStr of dates) {
  const range = nzServiceDayRange(dateStr);

  try {
    const result = (await p.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: dailySummaryPipeline(range, false),
      // Large batch size so all routes fit in the first batch (default of 101
      // would silently truncate the result to the first 101 routes).
      cursor: { batchSize: 100_000 },
    })) as unknown as { cursor: { firstBatch: DailyStats[] } };

    const stats = result.cursor.firstBatch;

    if (stats.length === 0) {
      console.log(`  ${dateStr}  (no events - skipped)`);
      continue;
    }

    const reply = await p.$runCommandRaw({
      update: "DailyRouteSummary",
      updates: summaryUpsertOps(stats, range.start, ON_TIME_LATE_SEC),
      ordered: false,
    });
    throwOnWriteErrors(reply, [], "DailyRouteSummary upsert");

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
