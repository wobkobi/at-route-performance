// scripts/backfill-trip-punctuality.ts
// Write AT's trip measures (punctual, reliable) onto DailyRouteSummary for service days the
// nightly rollup covered before it counted them. Only days with a daily summary and arrival
// events still in retention are written: the summary means the ghost pass has run, and the
// counts are built from the raw arrivals. Trips are judged against the stop ends TripMeta
// holds, so run the GTFS sync first. Safe to re-run: each day's counts are set, not added.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-trip-punctuality.ts 2026-10-02
//   npx tsx --env-file=.env.local scripts/backfill-trip-punctuality.ts --all
//   (--all = every completed day from the first day on record; add --dry-run to print each
//   day's network figures without writing)
import { dayHasEvents, daySummarised } from "@/lib/cron/aggregate";
import { tripPunctualityOfDay, writeTripPunctuality } from "@/lib/cron/trip-punctuality";
import { prisma } from "@/lib/db";
import { DATA_START_DAY } from "@/lib/time/data-start";
import { nzServiceDayString, shiftDays } from "@/lib/time/service-day";
import {
  emptyCounts,
  punctualPct,
  reliablePct,
  type PunctualityCounts,
} from "@/lib/trip/punctuality";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const args = argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const today = nzServiceDayString();

// Stepped by service date so a DST switch inside the range cannot skip or repeat a day.
const allDays: string[] = [];
for (let d = DATA_START_DAY; d < today; d = shiftDays(d, 1)) allDays.push(d);
const dates = args.length > 0 ? args : argv.includes("--all") ? allDays : [];

if (dates.length === 0) {
  console.error("Pass service dates (YYYY-MM-DD) or --all.");
  process.exit(1);
}

/**
 * Sum every route's counts into the network's.
 * @param counts - Counts per route.
 * @returns The network total.
 */
function networkTotal(counts: ReadonlyMap<string, PunctualityCounts>): PunctualityCounts {
  const total = emptyCounts();
  for (const c of counts.values()) {
    total.departed += c.departed;
    total.reliable += c.reliable;
    total.timed += c.timed;
    total.punctual += c.punctual;
    total.cancelled += c.cancelled;
  }
  return total;
}

/**
 * A percentage for the log, or a dash.
 * @param pct - The percentage, or null.
 * @returns The text.
 */
function pctText(pct: number | null): string {
  return pct === null ? "-" : `${pct.toFixed(1)}%`;
}

console.log(
  `${dryRun ? "Dry run over" : "Backfilling"} trip punctuality for ${dates.length} service day(s)\n`,
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
  if (!(await dayHasEvents(date))) {
    console.log(`  ${date}  skipped (arrivals past retention)`);
    skipped++;
    continue;
  }
  const dayStart = Date.now();
  try {
    if (dryRun) {
      const t = networkTotal(await tripPunctualityOfDay(date));
      console.log(
        `  ${date}  punctual ${pctText(punctualPct(t))} of ${t.timed + t.cancelled}, reliable ${pctText(reliablePct(t))} of ${t.departed + t.cancelled} (${t.cancelled} cancelled, ${((Date.now() - dayStart) / 1000).toFixed(1)}s)`,
      );
    } else {
      const routes = await writeTripPunctuality(date);
      console.log(
        `  ${date}  ok  (${routes} routes, ${((Date.now() - dayStart) / 1000).toFixed(1)}s)`,
      );
    }
    ok++;
  } catch (err) {
    console.error(`  ${date}  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

console.log(
  `\n${ok} ${dryRun ? "read" : "written"}, ${skipped} skipped, ${failed} failed in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
await prisma.$disconnect();
