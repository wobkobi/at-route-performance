// scripts/backfill-arrival-service-date.ts
/**
 * One-off backfill of ArrivalEvent.serviceDate over the whole archive, so every
 * reading of a run carries the run's own day. Modelled on
 * scripts/dedupe-arrival-events.ts.
 *
 * Pass one walks scheduledAt in one-hour slices from the collection's earliest
 * row - index-backed, so the NAS-hosted Mongo never holds a large working set -
 * and stamps every row that has no date yet with nzServiceDayString of its own
 * scheduledAt.
 *
 * Pass two folds the straddlers. A run that crossed the boundary hour has
 * readings on both sides of it and so took two dates from pass one. Each
 * service day's boundary is rescanned with RUN_TAIL_HOURS of slack on the late
 * side and twice that on the early side, foldRunDates (lib/run-day.ts) rewrites
 * the later readings of a two-date run onto the date of its earliest one, and
 * readings further than RUN_TAIL_HOURS from that earliest one keep their own
 * date, so a reused trip id cannot drag a whole day's readings onto one date.
 * On 15 September no run in the whole day spanned more than 104 minutes across
 * 15,364 runs, so that guard should never fire on clean data, which is why it
 * logs loudly when it does.
 *
 * Both passes are idempotent. Pass one writes only rows that have no date, so
 * re-running after a partial failure neither redoes finished work nor undoes
 * pass two; pass two sees a folded run already carrying one date and leaves it.
 *
 * Safe to run while ingest is live: ingest stamps its own rows from the trip
 * descriptor, and a row written after a slice has passed is already correct.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-arrival-service-date.ts [--dry-run] [--since=<hours>]
 */
import { type RunRowDate, foldRunDates } from "@/lib/run-day";
import { RUN_TAIL_HOURS, nzServiceDayRange, nzServiceDayString, shiftWeek } from "@/lib/time";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const tag = dryRun ? "[DRY RUN] " : "";
const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const sinceHours = sinceArg ? Number.parseInt(sinceArg.slice(8), 10) : null;

const HOUR_MS = 3_600_000;
const UPDATE_BATCH = 1000;
/** More straddling runs than this on one day is a timetable change, not a rounding artefact. */
const STRADDLER_ALARM = 5;

const oldest = sinceHours
  ? { scheduledAt: new Date(Date.now() - sinceHours * HOUR_MS) }
  : await p.arrivalEvent.findFirst({
      orderBy: { scheduledAt: "asc" },
      select: { scheduledAt: true },
    });
const newest = await p.arrivalEvent.findFirst({
  orderBy: { scheduledAt: "desc" },
  select: { scheduledAt: true },
});

if (!oldest || !newest) {
  console.log("No ArrivalEvent rows found - nothing to do.");
  await p.$disconnect();
  process.exit(0);
}

// Pass one: the per-row rule, over hour slices.
const startMs = Math.floor(oldest.scheduledAt.getTime() / HOUR_MS) * HOUR_MS;
const endMs = newest.scheduledAt.getTime() + 1;
const totalSlices = Math.ceil((endMs - startMs) / HOUR_MS);

console.log(
  `${tag}Pass 1: ${totalSlices} hour slices from ${new Date(startMs).toISOString()} to ` +
    `${newest.scheduledAt.toISOString()}`,
);

/** Rows per service date under pass one's rule, for the closing table. */
const perDay = new Map<string, number>();
let scanned = 0;
let stamped = 0;

for (let sliceMs = startMs; sliceMs < endMs; sliceMs += HOUR_MS) {
  const rows = await p.arrivalEvent.findMany({
    where: { scheduledAt: { gte: new Date(sliceMs), lt: new Date(sliceMs + HOUR_MS) } },
    select: { id: true, scheduledAt: true, serviceDate: true },
  });
  if (rows.length === 0) continue;
  scanned += rows.length;

  // An hour slice can only ever touch two service dates, and only when it is
  // the boundary hour itself, so this map holds at most two entries.
  const byDate = new Map<string, string[]>();
  for (const row of rows) {
    const date = row.serviceDate ?? nzServiceDayString(row.scheduledAt);
    perDay.set(date, (perDay.get(date) ?? 0) + 1);
    // A row ingest stamped from the trip descriptor is already right; leave it.
    if (row.serviceDate !== null) continue;
    const ids = byDate.get(date);
    if (ids) ids.push(row.id);
    else byDate.set(date, [row.id]);
  }

  for (const [date, ids] of byDate) {
    stamped += ids.length;
    if (dryRun) continue;
    for (let i = 0; i < ids.length; i += UPDATE_BATCH) {
      await p.arrivalEvent.updateMany({
        where: { id: { in: ids.slice(i, i + UPDATE_BATCH) } },
        data: { serviceDate: date },
      });
    }
  }
}

// Pass two: fold the runs that crossed a boundary.
console.log(`${tag}Pass 2: folding straddling runs, one boundary at a time.`);

const firstDate = nzServiceDayString(new Date(startMs));
const lastDate = nzServiceDayString(newest.scheduledAt);
let straddlerRuns = 0;
let movedRows = 0;
let overran = 0;

for (let date = firstDate; date <= lastDate; date = shiftWeek(date, 1)) {
  const boundary = nzServiceDayRange(date).end;
  // Twice the tail on the early side, so a run that began well before the
  // boundary is seen whole rather than clipped into a false earliest reading.
  // A trip id encodes its own scheduled departure, so inside a window this
  // short it can only ever name one run.
  const scanStart = new Date(boundary.getTime() - 2 * RUN_TAIL_HOURS * HOUR_MS);
  const scanEnd = new Date(boundary.getTime() + RUN_TAIL_HOURS * HOUR_MS);
  const rows = await p.arrivalEvent.findMany({
    where: { scheduledAt: { gte: scanStart, lt: scanEnd } },
    select: { id: true, tripId: true, scheduledAt: true, serviceDate: true },
  });
  if (rows.length === 0) continue;

  const byTrip = new Map<string, RunRowDate[]>();
  for (const r of rows) {
    const row: RunRowDate = {
      id: r.id,
      tripId: r.tripId,
      scheduledAt: r.scheduledAt,
      serviceDate: r.serviceDate ?? nzServiceDayString(r.scheduledAt),
    };
    const list = byTrip.get(row.tripId);
    if (list) list.push(row);
    else byTrip.set(row.tripId, [row]);
  }

  const foldable: RunRowDate[] = [];
  for (const list of byTrip.values()) {
    if (new Set(list.map((r) => r.serviceDate)).size < 2) continue;
    const first = list.reduce((a, b) => (a.scheduledAt <= b.scheduledAt ? a : b));
    const last = list.reduce((a, b) => (a.scheduledAt >= b.scheduledAt ? a : b));
    const spanMin = Math.round((last.scheduledAt.getTime() - first.scheduledAt.getTime()) / 60_000);
    if (first.scheduledAt.getTime() <= scanStart.getTime()) {
      overran++;
      console.warn(
        `  !! ${date}: run ${first.tripId} reaches back past the scan window ` +
          `(${spanMin} min inside it) - left alone`,
      );
      continue;
    }
    if (spanMin > RUN_TAIL_HOURS * 60) {
      overran++;
      console.warn(
        `  !! ${date}: run ${first.tripId} spans ${spanMin} min, past RUN_TAIL_HOURS - ` +
          `its tail keeps its own date`,
      );
    }
    foldable.push(...list);
  }

  const moves = foldRunDates(foldable);
  if (moves.size === 0) continue;

  const movedTrips = [...new Set(foldable.filter((r) => moves.has(r.id)).map((r) => r.tripId))];
  straddlerRuns += movedTrips.length;
  movedRows += moves.size;
  console.log(
    `  ${date}: ${movedTrips.length} straddling run(s), ${moves.size} row(s) folded` +
      `${dryRun ? " (dry run)" : ""}: ${movedTrips.join(", ")}`,
  );
  if (movedTrips.length > STRADDLER_ALARM) {
    console.warn(
      `  !! ${date}: ${movedTrips.length} straddling runs, well above the expected handful - ` +
        `check whether the timetable now runs real service across the boundary`,
    );
  }

  if (dryRun) continue;
  const byTarget = new Map<string, string[]>();
  for (const [id, target] of moves) {
    const ids = byTarget.get(target);
    if (ids) ids.push(id);
    else byTarget.set(target, [id]);
  }
  for (const [target, ids] of byTarget) {
    for (let i = 0; i < ids.length; i += UPDATE_BATCH) {
      await p.arrivalEvent.updateMany({
        where: { id: { in: ids.slice(i, i + UPDATE_BATCH) } },
        data: { serviceDate: target },
      });
    }
  }
}

console.log(`\n${tag}Rows per service date (pass one's rule, before the fold):`);
for (const date of [...perDay.keys()].sort()) {
  console.log(`  ${date}  ${String(perDay.get(date) ?? 0).padStart(7)}`);
}
console.log(
  `\n${tag}Done. Scanned ${scanned} rows; ${stamped} stamped` +
    `${dryRun ? " (dry run - nothing was written)" : ""}; ${straddlerRuns} straddling run(s), ` +
    `${movedRows} row(s) folded; ${overran} run(s) past RUN_TAIL_HOURS.`,
);
await p.$disconnect();
