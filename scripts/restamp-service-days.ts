// scripts/restamp-service-days.ts
/**
 * One-off migration for the service-day move to 4am. Rewrites the three stored
 * service-day stamps so each means the run's own day rather than the poll's:
 *
 *  - DailyRouteSummary: moves every `date` from the old boundary instant to the
 *    new one, and deletes the rows whose service date falls before the archive
 *    floor (the 10 rows stamped 2026-09-09T17:00Z, service day 2026-09-10, the
 *    purge remnant that has no events behind it). Those rows are dumped to a
 *    JSON file first: DailyRouteSummary is the only lasting record once
 *    ArrivalEvent is pruned.
 *  - CancelledTrip: rewrites `serviceDate` from a day-start instant to the
 *    `YYYY-MM-DD` string of the run's own day, and deletes the rows the string
 *    key collapses, keeping the earliest detection of each. These are the rows
 *    the old poll-day stamp filed twice, once either side of the 5am rollover.
 *    They are dumped too, with the id of the row kept in each case.
 *
 * Those two deletes are the only destructive actions in the migration, and each
 * dumps its rows before running, because a deleted row exists nowhere else.
 *  - OffRouteSighting: unsets `serviceDate` on every row that still carries it.
 *    The index is left alone - the schema change drops it, and dropping it here
 *    only means the next `prisma db push` recreates it.
 *
 * Runs AFTER the schema change deploys, not before it: from that deploy on, no
 * further DateTime service dates are written, so the two shapes coexist only for
 * this script's runtime. Writes through $runCommandRaw rather than the typed
 * client, which throws on a stored Date once the schema says String.
 *
 * Idempotent in all three passes - each selects only rows still in the old
 * shape - so a partial failure is repaired by running it again.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/restamp-service-days.ts [--dry-run] [--from=5] [--to=4]
 */
import { DATA_START_DAY } from "@/lib/data-start";
import { restampedSummaryDate } from "@/lib/restamp";
import { cancelledServiceDate } from "@/lib/run-day";
import { NZ_TZ, nzServiceDayString } from "@/lib/time";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const p = new PrismaClient();

const dryRun = process.argv.includes("--dry-run");
const tag = dryRun ? "[DRY RUN] " : "";

/**
 * Read a boundary-hour flag from argv.
 * @param flag - The flag name, e.g. "--to".
 * @param fallback - The hour to use when the flag is absent or unusable.
 * @returns The hour, 0-23.
 */
function hourArg(flag: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`${flag}=`));
  const n = raw ? Number.parseInt(raw.slice(flag.length + 1), 10) : Number.NaN;
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}

const fromHour = hourArg("--from", 5);
const toHour = hourArg("--to", 4);

/** Documents per raw write command (well under Mongo's limits). */
const WRITE_BATCH = 1000;

/** A stored row's `_id`, as extended JSON returns it. */
interface Oid {
  $oid: string;
}

/** A stored instant, as extended JSON returns it. */
interface Stamp {
  $date: string;
}

/**
 * Apply raw update statements in batches.
 * @param collection - Target collection.
 * @param updates - Update statements in extended JSON.
 * @returns How many documents the server reported as modified.
 */
async function applyUpdates(
  collection: string,
  updates: Record<string, unknown>[],
): Promise<number> {
  let modified = 0;
  for (let i = 0; i < updates.length; i += WRITE_BATCH) {
    const res = (await p.$runCommandRaw({
      update: collection,
      updates: updates.slice(i, i + WRITE_BATCH) as never,
      ordered: false,
    })) as unknown as { nModified?: number };
    modified += res.nModified ?? 0;
  }
  return modified;
}

/**
 * Delete rows by id in batches.
 * @param collection - Target collection.
 * @param ids - The `_id` values to remove.
 * @returns How many documents were removed.
 */
async function deleteByIds(collection: string, ids: string[]): Promise<number> {
  let removed = 0;
  for (let i = 0; i < ids.length; i += WRITE_BATCH) {
    const res = (await p.$runCommandRaw({
      delete: collection,
      deletes: [
        { q: { _id: { $in: ids.slice(i, i + WRITE_BATCH).map(($oid) => ({ $oid })) } }, limit: 0 },
      ] as never,
      ordered: false,
    })) as unknown as { n?: number };
    removed += res.n ?? 0;
  }
  return removed;
}

console.log(
  `${tag}Restamping service days from boundary hour ${fromHour} to ${toHour} (Auckland).`,
);

// 1) DailyRouteSummary. Only rows whose stamp still sits on the old boundary
// hour in Auckland local time are touched, which is what makes a repeat run a
// no-op rather than a second day's shift.
interface SummaryRow {
  _id: Oid;
  routeId: string;
  date: Stamp;
}

const summaries = (
  (await p.$runCommandRaw({
    aggregate: "DailyRouteSummary",
    pipeline: [
      { $match: { $expr: { $eq: [{ $hour: { date: "$date", timezone: NZ_TZ } }, fromHour] } } },
      { $project: { _id: 1, routeId: 1, date: 1 } },
    ],
    cursor: { batchSize: 100_000 },
  })) as unknown as { cursor: { firstBatch: SummaryRow[] } }
).cursor.firstBatch;

const summaryMoves: Record<string, unknown>[] = [];
const summaryDrops: SummaryRow[] = [];
for (const row of summaries) {
  const moved = restampedSummaryDate(new Date(row.date.$date), fromHour, toHour);
  if (nzServiceDayString(moved, toHour) < DATA_START_DAY) {
    summaryDrops.push(row);
    continue;
  }
  summaryMoves.push({
    q: { _id: { $oid: row._id.$oid } },
    u: { $set: { date: { $date: moved.toISOString() } } },
    multi: false,
  });
}

const dumpPath = `restamp-summary-drop-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(dumpPath, JSON.stringify(summaryDrops, null, 2));
console.log(
  `${tag}DailyRouteSummary: ${summaries.length} stamped at hour ${fromHour}; ` +
    `${summaryMoves.length} to move, ${summaryDrops.length} before ${DATA_START_DAY} to delete ` +
    `(dumped to ${dumpPath}).`,
);

let summariesMoved = 0;
let summariesDeleted = 0;
if (!dryRun) {
  summariesMoved = await applyUpdates("DailyRouteSummary", summaryMoves);
  summariesDeleted = await deleteByIds(
    "DailyRouteSummary",
    summaryDrops.map((r) => r._id.$oid),
  );
}

// 2) CancelledTrip. Rows still holding a BSON date are rewritten to the run's
// own service date as a string; where the string key collapses two rows onto one
// physical run, the earliest detection is kept and the rest deleted, because the
// unique key would otherwise refuse the second write.
interface FlagRow {
  _id: Oid;
  tripId: string;
  startTime?: string | null;
  detectedAt: Stamp;
}

const flags = (
  (await p.$runCommandRaw({
    find: "CancelledTrip",
    filter: { serviceDate: { $type: "date" } },
    projection: { _id: 1, tripId: 1, startTime: 1, detectedAt: 1 },
    batchSize: 100_000,
  })) as unknown as { cursor: { firstBatch: FlagRow[] } }
).cursor.firstBatch;

const kept = new Map<string, { row: FlagRow; at: number; date: string }>();
const flagDrops: { row: FlagRow; date: string; keptId: string }[] = [];
for (const row of flags) {
  const detectedAt = new Date(row.detectedAt.$date);
  const date = cancelledServiceDate(
    { tripId: row.tripId, startTime: row.startTime ?? null, detectedAt },
    toHour,
  );
  const key = `${row.tripId}|${date}`;
  const held = kept.get(key);
  if (!held) {
    kept.set(key, { row, at: detectedAt.getTime(), date });
  } else if (detectedAt.getTime() < held.at) {
    // `detectedAt` means when ingest FIRST saw the flag, so the earlier row wins.
    flagDrops.push({ row: held.row, date, keptId: row._id.$oid });
    kept.set(key, { row, at: detectedAt.getTime(), date });
  } else {
    flagDrops.push({ row, date, keptId: held.row._id.$oid });
  }
}

const flagMoves = [...kept.values()].map((k) => ({
  q: { _id: { $oid: k.row._id.$oid } },
  u: { $set: { serviceDate: k.date } },
  multi: false,
}));

const flagDumpPath = `restamp-flag-drop-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(flagDumpPath, JSON.stringify(flagDrops, null, 2));
console.log(
  `${tag}CancelledTrip: ${flags.length} still stamped as a date; ` +
    `${flagMoves.length} to rewrite, ${flagDrops.length} duplicate(s) to delete ` +
    `(dumped to ${flagDumpPath}).`,
);
for (const d of flagDrops) {
  console.log(
    `${tag}  duplicate ${d.row.tripId} on ${d.date}, detected ${d.row.detectedAt.$date}, ` +
      `keeping ${d.keptId}`,
  );
}

let flagsMoved = 0;
let flagsDeleted = 0;
if (!dryRun) {
  flagsDeleted = await deleteByIds(
    "CancelledTrip",
    flagDrops.map((d) => d.row._id.$oid),
  );
  flagsMoved = await applyUpdates("CancelledTrip", flagMoves);
}

// 3) OffRouteSighting. The field is written by ingest and read by nothing, and
// its stamp is a derived day-start instant, so it goes rather than moves.
const sightings = (
  (await p.$runCommandRaw({
    count: "OffRouteSighting",
    query: { serviceDate: { $exists: true } },
  })) as unknown as { n?: number }
).n;
console.log(`${tag}OffRouteSighting: ${sightings ?? 0} row(s) still carrying serviceDate.`);

let sightingsCleared = 0;
if (!dryRun) {
  sightingsCleared = await applyUpdates("OffRouteSighting", [
    { q: { serviceDate: { $exists: true } }, u: { $unset: { serviceDate: "" } }, multi: true },
  ]);
}

console.log(
  `\n${tag}Done. DailyRouteSummary ${summariesMoved} moved, ${summariesDeleted} deleted; ` +
    `CancelledTrip ${flagsMoved} rewritten, ${flagsDeleted} deleted; ` +
    `OffRouteSighting ${sightingsCleared} cleared.` +
    (dryRun ? " Dry run - nothing was written." : ""),
);

await p.$disconnect();
