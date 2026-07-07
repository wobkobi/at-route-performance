/**
 * One-off migration for the ArrivalEvent unique-key change (actualAt >
 * scheduledAt): remove duplicate rows per stop visit, keeping the row with the
 * latest actualAt (the most recent prediction/observation). Must complete
 * BEFORE `prisma db push` applies the new (tripId, stopId, scheduledAt) unique
 * index - index creation fails while duplicates exist.
 *
 * Scans in one-hour scheduledAt slices (index-backed, small enough for the M0
 * tier) and dedupes each slice in memory; duplicates always share scheduledAt,
 * so a slice never splits a duplicate group.
 *
 * `--since=<hours>` limits the scan to recent slices. The live ingest keeps
 * inserting revised predictions while no unique index exists, so a full 3.5M-row
 * rescan loses the race against the 2-minute ingest cadence; a recent-only pass
 * finishes in seconds and lets the index build land inside an ingest gap.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/dedupe-arrival-events.ts [--dry-run] [--since=<hours>]
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const sinceHours = sinceArg ? Number.parseInt(sinceArg.slice(8), 10) : null;

const HOUR_MS = 3_600_000;
const DELETE_BATCH = 1000;

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

const startMs = Math.floor(oldest.scheduledAt.getTime() / HOUR_MS) * HOUR_MS;
const endMs = newest.scheduledAt.getTime() + 1;
const totalSlices = Math.ceil((endMs - startMs) / HOUR_MS);

console.log(
  `${dryRun ? "[DRY RUN] " : ""}Scanning ${totalSlices} hour slices from ` +
    `${new Date(startMs).toISOString()} to ${newest.scheduledAt.toISOString()}`,
);

let scanned = 0;
let duplicates = 0;
let deleted = 0;

for (let sliceMs = startMs; sliceMs < endMs; sliceMs += HOUR_MS) {
  const rows = await p.arrivalEvent.findMany({
    where: { scheduledAt: { gte: new Date(sliceMs), lt: new Date(sliceMs + HOUR_MS) } },
    select: { id: true, tripId: true, stopId: true, scheduledAt: true, actualAt: true },
  });
  scanned += rows.length;
  if (rows.length === 0) continue;

  // Keep the latest actualAt per (tripId, stopId, scheduledAt); queue the rest.
  const keep = new Map<string, { id: string; actualAt: Date }>();
  const toDelete: string[] = [];
  for (const row of rows) {
    const key = `${row.tripId}|${row.stopId}|${row.scheduledAt.getTime()}`;
    const existing = keep.get(key);
    if (!existing) {
      keep.set(key, { id: row.id, actualAt: row.actualAt });
    } else if (row.actualAt > existing.actualAt) {
      toDelete.push(existing.id);
      keep.set(key, { id: row.id, actualAt: row.actualAt });
    } else {
      toDelete.push(row.id);
    }
  }

  duplicates += toDelete.length;
  if (!dryRun) {
    for (let i = 0; i < toDelete.length; i += DELETE_BATCH) {
      const res = await p.arrivalEvent.deleteMany({
        where: { id: { in: toDelete.slice(i, i + DELETE_BATCH) } },
      });
      deleted += res.count;
    }
  }
  if (toDelete.length > 0) {
    console.log(
      `  ${new Date(sliceMs).toISOString()}: ${rows.length} rows, ` +
        `${toDelete.length} duplicates${dryRun ? "" : " deleted"}`,
    );
  }
}

console.log(
  `\nDone. Scanned ${scanned} rows; ${duplicates} duplicates ` +
    (dryRun ? "found (dry run, nothing deleted)." : `found, ${deleted} deleted.`),
);
await p.$disconnect();
