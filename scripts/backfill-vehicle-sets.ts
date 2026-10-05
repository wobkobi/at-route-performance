// scripts/backfill-vehicle-sets.ts
// Write each route's vehicle set into DailyVehicleSet for service days the nightly rollup
// covered before it stored them, so the home page's vehicle counts read those days instead
// of scanning their arrivals. Only days with a daily summary and arrival events still in
// retention are written: the summary means the ghost pass has run, and the sets are built
// from the raw arrivals. Safe to re-run: each day's rows are replaced, not added to.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-vehicle-sets.ts 2026-10-02
//   npx tsx --env-file=.env.local scripts/backfill-vehicle-sets.ts --all
//   (--all = every completed day from the first day on record; add --dry-run to read each
//   day without writing, and --compare to check the read sets' counts, all day and for a
//   morning band, against a live scan of the day's arrivals)
import { dayHasEvents, daySummarised } from "@/lib/cron/aggregate";
import {
  dayVehiclesMatch,
  hourRangeMask,
  type VehicleSeen,
  vehicleSetsOfDay,
  writeVehicleSets,
} from "@/lib/cron/vehicle-sets";
import { aggregateRows, dateWindow } from "@/lib/data/raw";
import { prisma } from "@/lib/db";
import { type Mode, modeOrBus, MODES } from "@/lib/mode";
import { DATA_START_DAY } from "@/lib/time/data-start";
import { NZ_TZ } from "@/lib/time/nz-tz";
import { nzServiceDayRange, nzServiceDayString, shiftDays } from "@/lib/time/service-day";
import { type HourRange, hoursInRange } from "@/lib/time/time-of-day";

const argv = process.argv.slice(2);
const compare = argv.includes("--compare");
const dryRun = compare || argv.includes("--dry-run");
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

/** The band --compare checks the hour bits on: 7am to 10am. */
const MORNING: HourRange = { from: 7, to: 10 };

const modeOf = new Map(
  (await prisma.route.findMany({ select: { id: true, mode: true } })).map((r) => [
    r.id,
    modeOrBus(r.mode),
  ]),
);

/**
 * Distinct vehicles per mode, each under the mode of its lowest route id, as the counts read.
 * @param rows - One `{ v, r }` row per vehicle and route.
 * @returns The count per mode.
 */
function countByMode(rows: readonly { v: string; r: string }[]): Record<Mode, number> {
  const routeOf = new Map<string, string>();
  for (const { v, r } of rows) {
    const seen = routeOf.get(v);
    if (seen === undefined || r < seen) routeOf.set(v, r);
  }
  const counts = { BUS: 0, TRAIN: 0, FERRY: 0 };
  for (const r of routeOf.values()) {
    const mode = modeOf.get(r);
    if (mode) counts[mode]++;
  }
  return counts;
}

/**
 * The read sets flattened to vehicle and route rows, keeping only vehicles due in a band.
 * @param sets - Route id to its vehicles.
 * @param hours - The band, or null for all day.
 * @returns One row per vehicle and route.
 */
function setRows(
  sets: ReadonlyMap<string, readonly VehicleSeen[]>,
  hours: HourRange | null,
): { v: string; r: string }[] {
  const mask = hours ? hourRangeMask(hours) : null;
  return [...sets].flatMap(([r, vs]) =>
    vs.filter(({ h }) => mask === null || (h & mask) !== 0).map(({ v }) => ({ v, r })),
  );
}

/**
 * Scan one day's arrivals the way the live count does, for --compare.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param hours - The band, or null for all day.
 * @returns One row per vehicle and route.
 */
function liveRows(date: string, hours: HourRange | null): Promise<{ v: string; r: string }[]> {
  const match = dayVehiclesMatch(dateWindow(nzServiceDayRange(date)), true);
  if (hours) {
    match.$expr = {
      $in: [{ $hour: { date: "$scheduledAt", timezone: NZ_TZ } }, hoursInRange(hours)],
    };
  }
  return aggregateRows<{ v: string; r: string }>("ArrivalEvent", [
    { $match: match },
    { $group: { _id: { v: "$vehicleId", r: "$routeId" } } },
    { $project: { _id: 0, v: "$_id.v", r: "$_id.r" } },
  ]);
}

/**
 * Counts per mode for the log.
 * @param counts - The count per mode.
 * @returns The text.
 */
function countsText(counts: Record<Mode, number>): string {
  return MODES.map((m) => `${m.toLowerCase()} ${counts[m]}`).join(", ");
}

/**
 * Check one band's counts from the read sets against the live scan's.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param sets - Route id to its vehicles.
 * @param hours - The band, or null for all day.
 * @returns Whether every mode's count matched.
 */
async function compareBand(
  date: string,
  sets: ReadonlyMap<string, readonly VehicleSeen[]>,
  hours: HourRange | null,
): Promise<boolean> {
  const stored = countByMode(setRows(sets, hours));
  const live = countByMode(await liveRows(date, hours));
  const same = MODES.every((m) => stored[m] === live[m]);
  const band = hours ? "morning" : "all day";
  console.log(
    same
      ? `      ${band}: match (${countsText(stored)})`
      : `      ${band}: MISMATCH stored ${countsText(stored)} / live ${countsText(live)}`,
  );
  return same;
}

console.log(
  `${dryRun ? "Dry run over" : "Backfilling"} vehicle sets for ${dates.length} service day(s)\n`,
);

let ok = 0;
let skipped = 0;
let failed = 0;
let mismatched = 0;
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
      const sets = await vehicleSetsOfDay(date);
      const pairs = [...sets.values()].reduce((n, vs) => n + vs.length, 0);
      console.log(
        `  ${date}  ${sets.size} routes, ${pairs} vehicle-route pairs (${((Date.now() - dayStart) / 1000).toFixed(1)}s)`,
      );
      if (compare) {
        const allDay = await compareBand(date, sets, null);
        const morning = await compareBand(date, sets, MORNING);
        if (!allDay || !morning) mismatched++;
      }
    } else {
      const routes = await writeVehicleSets(date);
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
  `\n${ok} ${dryRun ? "read" : "written"}, ${skipped} skipped, ${failed} failed${compare ? `, ${mismatched} mismatched` : ""} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
await prisma.$disconnect();
