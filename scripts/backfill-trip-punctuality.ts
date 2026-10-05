// scripts/backfill-trip-punctuality.ts
// Write AT's trip measures (punctual, reliable) into DailyTripTally for service days the
// nightly rollup covered before it counted them, and drop any trip tallies left on those
// days' DailyRouteSummary rows, which the schema does not carry. Only days with a daily summary and arrival
// events still in retention are written: the summary means the ghost pass has run, and the
// counts are built from the raw arrivals. Trips are judged against the stop ends TripMeta
// holds, so run the GTFS sync first. Safe to re-run: each day's rows are replaced, not added to.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-trip-punctuality.ts 2026-10-02
//   npx tsx --env-file=.env.local scripts/backfill-trip-punctuality.ts --all
//   (--all = every completed day from the first day on record; add --dry-run to print each
//   day's network figures without writing)
import { dayHasEvents, daySummarised } from "@/lib/cron/aggregate";
import { tripPunctualityOfDay, writeTripPunctuality } from "@/lib/cron/trip-punctuality";
import { dateWindow } from "@/lib/data/raw";
import { prisma, runCommand, throwOnWriteErrors } from "@/lib/db";
import { DATA_START_DAY } from "@/lib/time/data-start";
import { nzServiceDayRange, nzServiceDayString, shiftDays } from "@/lib/time/service-day";
import { punctualPct, reliablePct, sumCounts } from "@/lib/trip/punctuality";

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
 * A percentage for the log, or a dash.
 * @param pct - The percentage, or null.
 * @returns The text.
 */
function pctText(pct: number | null): string {
  return pct === null ? "-" : `${pct.toFixed(1)}%`;
}

/** Trip tally fields DailyRouteSummary rows may still hold, which the schema does not carry. */
const SUMMARY_TALLY_FIELDS = [
  "tripsDeparted",
  "tripsReliable",
  "tripsTimed",
  "tripsPunctual",
  "tripsCancelled",
];

/**
 * Drop any trip tallies left on one day's summary rows, so DailyTripTally is the only copy.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns How many rows lost a field.
 */
async function clearSummaryTallies(date: string): Promise<number> {
  const reply = await runCommand(() =>
    prisma.$runCommandRaw({
      update: "DailyRouteSummary",
      updates: [
        {
          q: { date: dateWindow(nzServiceDayRange(date)), tripsDeparted: { $exists: true } },
          u: { $unset: Object.fromEntries(SUMMARY_TALLY_FIELDS.map((f) => [f, ""])) },
          multi: true,
        },
      ],
    }),
  );
  throwOnWriteErrors(reply, [], "DailyRouteSummary tally clear");
  return Number((reply as { nModified?: number }).nModified ?? 0);
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
      const t = sumCounts(Object.fromEntries(await tripPunctualityOfDay(date)));
      console.log(
        `  ${date}  punctual ${pctText(punctualPct(t))} of ${t.timed + t.cancelled}, reliable ${pctText(reliablePct(t))} of ${t.departed + t.cancelled} (${t.cancelled} cancelled, ${((Date.now() - dayStart) / 1000).toFixed(1)}s)`,
      );
    } else {
      const routes = await writeTripPunctuality(date);
      const cleared = await clearSummaryTallies(date);
      console.log(
        `  ${date}  ok  (${routes} routes, ${cleared} summary rows cleared, ${((Date.now() - dayStart) / 1000).toFixed(1)}s)`,
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
