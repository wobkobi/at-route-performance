// scripts/migrate-last-seen-at.ts
// One-off repair for Route.lastSeenAt rows stored as ISO strings. The routes
// sync once passed a JS Date straight into $runCommandRaw, which JSON-serialises
// it, so the field landed as a string and Prisma refuses to read it as DateTime
// (P2023), taking GET /api/routes and the 404 page's directory down with it.
// Converts every string value in place with $toDate. Idempotent: a no-op once
// no string values remain.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/migrate-last-seen-at.ts [--dry-run]
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

/**
 * Count Route rows by the BSON type of `lastSeenAt`.
 * @returns Row count per BSON type name ("date", "string", "missing", ...).
 */
async function typeCounts(): Promise<Record<string, number>> {
  const res = (await p.$runCommandRaw({
    aggregate: "Route",
    pipeline: [{ $group: { _id: { $type: "$lastSeenAt" }, n: { $sum: 1 } } }],
    cursor: {},
  })) as unknown as { cursor: { firstBatch: { _id: string; n: number }[] } };
  return Object.fromEntries(res.cursor.firstBatch.map((r) => [r._id, r.n]));
}

const before = await typeCounts();
console.log(`${dryRun ? "[DRY RUN] " : ""}lastSeenAt types before:`, before);

const strings = before.string ?? 0;
if (strings === 0) {
  console.log("No string-typed lastSeenAt rows - nothing to do.");
} else if (dryRun) {
  console.log(`Would convert ${strings} row(s) in place with $toDate.`);
} else {
  const res = (await p.$runCommandRaw({
    update: "Route",
    updates: [
      {
        q: { lastSeenAt: { $type: "string" } },
        u: [{ $set: { lastSeenAt: { $toDate: "$lastSeenAt" } } }],
        multi: true,
      },
    ],
  })) as unknown as { n?: number; nModified?: number; writeErrors?: unknown[] };
  if (res.writeErrors?.length) {
    console.error("Write errors:", res.writeErrors);
    process.exitCode = 1;
  }
  console.log(`Converted ${res.nModified ?? 0} of ${res.n ?? 0} matched row(s).`);
  console.log("lastSeenAt types after:", await typeCounts());
}

await p.$disconnect();
