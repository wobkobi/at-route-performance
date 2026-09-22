// src/lib/ingest-spool.ts
// Holding pen for writes the database was not up to take. AT's realtime feed is
// a snapshot of one moment and nothing re-fetches it, so a batch that cannot be
// written now is lost unless it is kept somewhere that is not the database -
// which rules out the database itself. Blob storage is that somewhere.
//
// Replaying a batch is safe by construction: the inserts run `ordered: false`
// with duplicate keys ignored, and the arrival writes are upserts keyed on the
// stop visit. A batch that partly landed before the outage no-ops on replay.

import { del, get, list, put } from "@vercel/blob";
import { gunzipSync, gzipSync } from "fflate";

/** Blob pathname prefix every spooled batch lives under. */
const PREFIX = "ingest-spool/";

/**
 * Batches replayed per run. The scheduler fires every two minutes and a poll
 * already takes 2.6s at the median, so a drain that ran unbounded after a long
 * outage would collide with the next poll rather than catch up sooner.
 */
const MAX_DRAIN_PER_RUN = 8;

/**
 * A batch older than this is dropped unreplayed. An outage measured in days is
 * a hole in the archive either way, and replaying stale predictions on top of
 * whatever the nightly aggregate has since settled is worse than the gap.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** One write held back from a poll, in the shape the replay re-issues it. */
export type SpooledWrite =
  | { kind: "insert"; collection: string; docs: Record<string, unknown>[] }
  | { kind: "arrivals"; docs: unknown[] };

/** What a drain did, for the run's log line. */
export interface DrainResult {
  replayed: number;
  rows: number;
  dropped: number;
  /** True when the database was still down, so the rest was left for next time. */
  stoppedEarly: boolean;
}

/**
 * Whether a spool store is configured. Without the token every spool call is a
 * no-op and the ingest behaves as it did before: the rows are lost and the run
 * fails loudly. That is deliberate, so this can ship before the store exists.
 * @returns True when `BLOB_READ_WRITE_TOKEN` is set.
 */
export function spoolEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Hold a poll's writes for a later run. Spooling is best effort: if the blob
 * put fails too, the rows are gone, and saying so in the log is all that is
 * left to do - throwing here would replace one lost poll with a failed run.
 * @param writes - The writes the database refused, in the order to replay them.
 * @returns True when the batch was stored.
 */
export async function spoolWrites(writes: SpooledWrite[]): Promise<boolean> {
  if (!spoolEnabled() || writes.length === 0) return false;
  try {
    const body = Buffer.from(gzipSync(new TextEncoder().encode(JSON.stringify(writes))));
    // The timestamp leads the pathname so a prefix listing sorts oldest first,
    // and the random suffix keeps two polls of the same second apart.
    await put(`${PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}.json.gz`, body, {
      access: "private",
      contentType: "application/gzip",
    });
    return true;
  } catch (err) {
    console.error("[SPOOL] Could not hold the batch", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Read a spooled batch back.
 * @param pathname - The blob's pathname.
 * @returns The writes it holds, or null when it cannot be read.
 */
async function readBatch(pathname: string): Promise<SpooledWrite[] | null> {
  const found = await get(pathname, { access: "private" });
  if (!found) return null;
  const body = new Uint8Array(await new Response(found.stream).arrayBuffer());
  return JSON.parse(new TextDecoder().decode(gunzipSync(body))) as SpooledWrite[];
}

/**
 * Replay what the database missed, oldest first, then delete what landed. Stops
 * at the first batch that fails: a database still down will refuse the next one
 * too, and the point of the spool is that nothing is dropped for trying again
 * too eagerly. A batch that cannot be parsed is deleted rather than retried
 * forever - it is already unreadable, so it is not data any more.
 * @param replay - Re-issues one batch's writes; throws if the database refuses.
 * @returns What was replayed, dropped, and whether more is waiting.
 */
export async function drainSpool(
  replay: (writes: SpooledWrite[]) => Promise<number>,
): Promise<DrainResult> {
  const out: DrainResult = { replayed: 0, rows: 0, dropped: 0, stoppedEarly: false };
  if (!spoolEnabled()) return out;

  let batches;
  try {
    ({ blobs: batches } = await list({ prefix: PREFIX, limit: MAX_DRAIN_PER_RUN }));
  } catch (err) {
    console.error("[SPOOL] Could not list the spool", {
      error: err instanceof Error ? err.message : String(err),
    });
    return out;
  }

  const cutoff = Date.now() - MAX_AGE_MS;
  for (const batch of [...batches].sort((a, b) => a.pathname.localeCompare(b.pathname))) {
    if (batch.uploadedAt.getTime() < cutoff) {
      await del(batch.pathname).catch(() => undefined);
      out.dropped += 1;
      continue;
    }
    try {
      const writes = await readBatch(batch.pathname);
      if (writes) out.rows += await replay(writes);
      await del(batch.pathname);
      if (writes) out.replayed += 1;
      else out.dropped += 1;
    } catch (err) {
      // A parse failure is not worth retrying; a refused write is.
      if (err instanceof SyntaxError) {
        await del(batch.pathname).catch(() => undefined);
        out.dropped += 1;
        continue;
      }
      console.error("[SPOOL] Replay stopped", {
        pathname: batch.pathname,
        error: err instanceof Error ? err.message : String(err),
      });
      out.stoppedEarly = true;
      break;
    }
  }
  return out;
}
