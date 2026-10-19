// src/lib/feed/ingest-spool.ts
// Holding pen for writes the database was not up to take. AT's realtime feed is
// a snapshot of one moment and nothing re-fetches it, so a batch that cannot be
// written now is lost unless it is kept somewhere that is not the database -
// which rules out the database itself. Blob storage is that somewhere.
//
// Replaying a batch is safe by construction: the inserts run `ordered: false`
// with duplicate keys ignored, and the arrival writes are upserts keyed on the
// stop visit. A batch that partly landed before the outage no-ops on replay.

import { isDatabaseUnreachableError } from "@/lib/db";
import type { RecordedRun } from "@/lib/feed/ingest-run";
import { MS_PER_DAY } from "@/lib/time/service-day";
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
const MAX_AGE_MS = MS_PER_DAY;

/**
 * A run stamp older than this means a poll went unrecorded, so the spool may hold
 * what that poll could not write. One and a half of the two-minute cadence: a
 * cron firing a little late must not read as a missed poll, and a wider window
 * would leave a held batch waiting longer for its replay.
 */
const MISSED_RUN_MS = 180_000;

/**
 * How long a poll may spend on database calls before it holds what is left and
 * finishes. Under the two-minute cadence on purpose: a poll that ends inside its
 * own slot has released the lease before the next one fires, so a slow database
 * costs a spooled batch rather than a skipped poll. The 40s of slack covers the
 * spool put, the bounded lease release and the scheduler's ~15s of jitter within
 * its minute.
 */
export const POLL_BUDGET_MS = 80_000;

/** Returned in place of a result by a call still running when its time ran out. */
export const LATE = Symbol("late");

/** One write held back from a poll, in the shape the replay re-issues it. */
export type SpooledWrite =
  | { kind: "insert"; collection: string; docs: Record<string, unknown>[] }
  | { kind: "arrivals"; docs: unknown[] };

/** What one poll could not write, and whether it has stopped calling the database. */
export interface PollHold {
  /** Writes held back, in the order to replay them. */
  writes: SpooledWrite[];
  /**
   * Set by the first call that finds the database unreachable, or that is still
   * running at the deadline. Once set, the poll stops calling the database: a
   * call against a stopped mongod waits out the driver's 30s server selection
   * and a write retries that five times, and a slow one never throws at all, so
   * a poll that kept trying ran into Vercel's 300s limit and was killed before it
   * reached the spool - losing the very rows the spool exists for.
   */
  down: boolean;
  /** Epoch ms after which no further database call starts. */
  deadline: number;
}

/**
 * A fresh hold for a poll.
 * @param startedAt - Epoch ms the poll started.
 * @returns An empty hold whose deadline is {@link POLL_BUDGET_MS} after the start.
 */
export function newPollHold(startedAt: number): PollHold {
  return { writes: [], down: false, deadline: startedAt + POLL_BUDGET_MS };
}

/** What a drain did, for the run's log line. */
export interface DrainResult {
  replayed: number;
  rows: number;
  dropped: number;
  /** True when the database was still down, so the rest was left for next time. */
  stoppedEarly: boolean;
  /** True when the spool may still hold batches, so a later run must drain again. */
  pending: boolean;
}

/**
 * Whether a spool store is configured. Both of the SDK's own auth paths count,
 * because a check that knew only about the token would read a working
 * OIDC-authenticated store as no store at all - and this failing quietly means
 * an outage loses data while the configuration looks right.
 *
 * Without either, every spool call is a no-op and the ingest behaves as it did
 * before: the rows are lost and the run fails loudly. That is deliberate, so
 * this can ship before the store exists.
 * @returns True when a read-write token, or a store id with an OIDC token, is set.
 */
export function spoolEnabled(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ??
    (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
  );
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
    // The timestamp leads the pathname so a prefix listing sorts oldest first.
    // The suffix is not decoration: a put to an existing pathname overwrites it,
    // and polls do overlap - one takes 53s at p99 against a 120s cadence - so
    // two of them holding a batch at once must not land on the same name.
    await put(`${PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}.json.gz`, body, {
      access: "private",
      addRandomSuffix: true,
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
 * Note a failed database call, marking the poll down when the failure says the
 * database is unreachable. Any other failure leaves the poll as it was: a bad
 * document or a failed validation says nothing about whether the next call
 * will land.
 * @param hold - The poll's hold.
 * @param err - The thrown value.
 */
export function noteOutage(hold: PollHold, err: unknown): void {
  if (isDatabaseUnreachableError(err)) hold.down = true;
}

/**
 * Give a call at most `ms` to settle. The call is not cancelled when time runs
 * out - Prisma's raw commands take no abort signal - so it carries on in the
 * background, and a rejection it settles with later is swallowed rather than
 * left unhandled.
 * @param run - Starts the call.
 * @param ms - How long to wait for it.
 * @returns The call's result, or {@link LATE} when it was still running.
 */
export async function within<T>(run: () => Promise<T>, ms: number): Promise<T | typeof LATE> {
  const work = run();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => resolve(LATE), Math.max(0, ms));
  });
  try {
    const out = await Promise.race([work, late]);
    if (out === LATE) work.catch(() => {});
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Make a database call only if the poll has time left, and stop waiting on it
 * at the deadline. Either way out of time marks the poll down, so every later
 * call is skipped too. A call already past the deadline is never started.
 * @param run - Starts the call.
 * @param hold - The poll's hold, marked down when time runs out.
 * @returns The call's result, or {@link LATE} when it ran out of time.
 */
export async function beforeDeadline<T>(
  run: () => Promise<T>,
  hold: PollHold,
): Promise<T | typeof LATE> {
  const left = hold.deadline - Date.now();
  const out = left > 0 ? await within(run, left) : LATE;
  if (out === LATE) hold.down = true;
  return out;
}

/**
 * Run a write, or hold it back for a later run when the database is
 * unreachable or too slow to take it before the poll's deadline. Only those are
 * held: a write that failed on its own merits would fail the same way on replay,
 * so it still fails the run and gets seen. Once the poll is down, the write is
 * held without being tried at all, which is what keeps the poll inside the
 * function limit.
 *
 * A write that missed the deadline may still land afterwards. Replaying it is
 * harmless, since the inserts ignore duplicates and the arrival writes are
 * upserts; the one cost is that a late upsert can put back a prediction a newer
 * write already replaced, until the next poll writes the visit again.
 *
 * Without a spool store nothing is held: the write is tried and its failure
 * thrown, so the rows are lost loudly rather than parked somewhere that does
 * not exist.
 * @param attempt - Issues the write.
 * @param held - The same write in the shape the replay re-issues it.
 * @param hold - The poll's hold, which collects the write when it is held.
 * @returns Rows written, or 0 when the write was held.
 */
export async function writeOrHold(
  attempt: () => Promise<number>,
  held: SpooledWrite,
  hold: PollHold,
): Promise<number> {
  if (!spoolEnabled()) return attempt();
  if (!hold.down) {
    try {
      const out = await beforeDeadline(attempt, hold);
      if (out !== LATE) return out;
    } catch (err) {
      noteOutage(hold, err);
      if (!hold.down) throw err;
    }
  }
  hold.writes.push(held);
  return 0;
}

/**
 * Read a spooled batch back. The SDK's result is a union keyed on `statusCode`
 * and only a 200 carries a stream - a 304 answers a conditional request with
 * `stream: null`, which nothing here asks for but which would read as an empty
 * body rather than a missing one.
 * @param pathname - The blob's pathname.
 * @returns The writes it holds, or null when it cannot be read.
 */
async function readBatch(pathname: string): Promise<SpooledWrite[] | null> {
  const found = await get(pathname, { access: "private" });
  if (found?.statusCode !== 200) return null;
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
  const out: DrainResult = {
    replayed: 0,
    rows: 0,
    dropped: 0,
    stoppedEarly: false,
    pending: false,
  };
  if (!spoolEnabled()) return out;

  let batches;
  try {
    ({ blobs: batches } = await list({ prefix: PREFIX, limit: MAX_DRAIN_PER_RUN }));
  } catch (err) {
    console.error("[SPOOL] Could not list the spool", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Nothing was read, so nothing can be ruled out: ask again next run rather
    // than wait for the next gap in the run stamps to prompt it.
    out.pending = true;
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
  // A refused write leaves batches behind for certain, and a full page of
  // listings means there may be more behind it than the cap read.
  out.pending = out.stoppedEarly || batches.length === MAX_DRAIN_PER_RUN;
  return out;
}

/**
 * Whether the spool is worth listing on this poll.
 *
 * Listing costs a Blob operation every run, and the spool is empty except after a
 * database outage, so the question is answered from the run stamps instead. A poll
 * that could not reach the database could not record itself either, so a gap in
 * the stamps is the only evidence left that one ran and held its writes back. A
 * run that did record itself says outright whether it left batches behind.
 * @param last - The newest recorded run, or null when none is logged.
 * @param now - Instant to measure the gap from; read from the clock when omitted.
 * @returns True when a drain should run.
 */
export function spoolMayHold(last: RecordedRun | null, now?: number): boolean {
  if (!spoolEnabled()) return false;
  // No stamp at all is a fresh deployment or a wiped log, where being wrong once
  // costs a single listing and the other way costs a held batch.
  if (!last) return true;
  if (last.spoolPending) return true;
  return (now ?? Date.now()) - last.completedAt.getTime() > MISSED_RUN_MS;
}
