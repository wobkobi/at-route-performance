// scripts/backfill-hourly-summaries.ts
// Write HourlyRouteSummary for service days the nightly rollup covered before
// it wrote hourly rows. Only days that already have a DailyRouteSummary are
// written: their ghost pass has run, so the hourly counts match the daily ones
// and the magnitude guard can come off. Any other day is skipped, and the next
// nightly run writes it with its daily rollup. Safe to re-run: every row is an
// upsert on (routeId, date, hour).
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-hourly-summaries.ts 2026-09-12
//   npx tsx --env-file=.env.local scripts/backfill-hourly-summaries.ts --all
//   (--all = every completed day from the first day on record; add --dry-run to
//   list the days without writing)
import { daySummarised, writeHourlySummary } from "@/lib/cron/aggregate";
import { prisma } from "@/lib/db";
import { DATA_START_DAY } from "@/lib/time/data-start";
import { nzServiceDayRange, nzServiceDayString, shiftDays } from "@/lib/time/service-day";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const args = argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const today = nzServiceDayString();

// Stepped by service date so a DST switch inside the range cannot skip or
// repeat a day.
const allDays: string[] = [];
for (let d = DATA_START_DAY; d < today; d = shiftDays(d, 1)) allDays.push(d);
const dates = args.length > 0 ? args : argv.includes("--all") ? allDays : [];

if (dates.length === 0) {
  console.error("Pass service dates (YYYY-MM-DD) or --all.");
  process.exit(1);
}

console.log(
  `${dryRun ? "Would backfill" : "Backfilling"} HourlyRouteSummary for ${dates.length} service day(s)\n`,
);

let ok = 0;
let skipped = 0;
let failed = 0;
const started = Date.now();

for (const date of dates) {
  if (date >= today) {
    console.log(`  ${date}  skipped (not completed)`);
    skipped++;
    continue;
  }
  if (!(await daySummarised(date))) {
    console.log(`  ${date}  skipped (no daily summary, so no ghost pass yet)`);
    skipped++;
    continue;
  }
  if (dryRun) {
    console.log(`  ${date}  would write`);
    continue;
  }
  const dayStart = Date.now();
  try {
    const rows = await writeHourlySummary(nzServiceDayRange(date));
    console.log(
      `  ${date}  ok  (${rows.toLocaleString("en-NZ")} route-hours, ${((Date.now() - dayStart) / 1000).toFixed(1)}s)`,
    );
    ok++;
  } catch (err) {
    console.error(`  ${date}  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

console.log(
  `\n${ok} written, ${skipped} skipped, ${failed} failed in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
await prisma.$disconnect();
