// src/lib/feed/ingest-lease.ts
// A lease that keeps two realtime polls from writing at the same time. A poll on
// a slow database can run past the two-minute cadence; the next poll then writes
// alongside it, both slow further, and polls pile up until each one is killed at
// the function limit without recording a run. With the lease, a poll that finds
// another still running skips instead.
import { prisma } from "@/lib/db";

/** The `setting` document that holds the lease. */
const LEASE_ID = "ingest-lease-at";

/**
 * How long a claim holds. Just under Vercel's 300-second function limit: a run
 * the platform kills never releases its claim, so the claim has to lapse by
 * itself before the poll after next.
 */
export const LEASE_MS = 290_000;

/** A poll that went ahead without a lease, because the database could not be asked. */
export const UNLEASED = "unleased";

/**
 * Whether a write failed on a duplicate `_id`, which is how a held lease refuses
 * the upsert below.
 * @param err - The error thrown by the command.
 * @returns True for a duplicate-key error.
 */
function isDuplicateKey(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /E11000|duplicate key/i.test(msg);
}

/**
 * Claim the lease for one poll. One atomic upsert: the filter matches only an
 * expired claim, so an expired or missing lease is taken, and a live one makes
 * the upsert try to insert a second document with the same `_id`, which fails.
 *
 * A database that cannot be reached at all answers {@link UNLEASED} rather than
 * a refusal, so the poll still runs and its writes go to the outage spool.
 * @param now - The current time, epoch ms.
 * @returns A token to release with, {@link UNLEASED}, or null when another poll holds the lease.
 */
export async function claimIngestLease(now: number = Date.now()): Promise<string | null> {
  const token = `${now}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await prisma.$runCommandRaw({
      findAndModify: "setting",
      query: { _id: LEASE_ID, until: { $lt: { $date: new Date(now).toISOString() } } },
      update: {
        $set: { value: token, until: { $date: new Date(now + LEASE_MS).toISOString() } },
      },
      upsert: true,
    });
    return token;
  } catch (err) {
    if (isDuplicateKey(err)) return null;
    console.error("[INGEST] Lease unavailable, polling without it", {
      error: err instanceof Error ? err.message : String(err),
    });
    return UNLEASED;
  }
}

/**
 * Give the lease back, if this poll still holds it. Matched on the token, so a
 * run that outlived its claim cannot release the next poll's.
 * @param token - The token {@link claimIngestLease} returned.
 */
export async function releaseIngestLease(token: string): Promise<void> {
  if (token === UNLEASED) return;
  await prisma.$runCommandRaw({
    update: "setting",
    updates: [
      {
        q: { _id: LEASE_ID, value: token },
        u: { $set: { until: { $date: new Date(0).toISOString() } } },
      },
    ],
  });
}
