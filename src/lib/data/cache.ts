// src/lib/data/cache.ts
// Cache policy for the date-scoped aggregations: when a window is final, how long it holds,
// and the live-day clip on scheduledAt.
import { prisma } from "@/lib/db";
import { realDeviationMatchFor } from "@/lib/deviation";
import { getLastIngestRun, INGEST_INTERVAL_SEC } from "@/lib/ingest-run";
import { unstable_cache } from "@/lib/mem-cache";
import {
  type DateRange,
  nzServiceDayRange,
  nzServiceDayString,
  serviceDatesInRange,
} from "@/lib/time";

/**
 * Normalise an extended-JSON date (`{ $date }`) or ISO string to an ISO string.
 * `$runCommandRaw` returns dates as `{ $date }`; this flattens them.
 * @param d - An extended-JSON date or an ISO string.
 * @returns The ISO instant string.
 */
export function toIso(d: { $date: string } | string): string {
  return typeof d === "string" ? d : d.$date;
}

export const MS_IN_DAY = 86_400_000;

/** Cache TTL for a completed, classified service day's aggregation (seconds). */
const COMPLETED_DAY_REVALIDATE = 7 * 86_400;

/**
 * Bumped whenever the ghost classification changes what a completed day's boards
 * say. A recompute changes neither the cache key nor the seven-day TTL, and
 * `unstable_cache` persists its entries across requests and deployments, so
 * without this a repaired day keeps serving its old numbers for a week.
 */
const PASS_VERSION = "g2";

/**
 * The full key an aggregation caches under: the classification version, the
 * caller's own parts, then the window's state.
 * @param keyParts - Cache key parts unique to the query and its window.
 * @param state - The window's state, from {@link cacheState}.
 * @returns The key parts, in order.
 */
export function cacheKey(keyParts: readonly string[], state: string): string[] {
  return [PASS_VERSION, ...keyParts, state];
}

/**
 * Cache TTL for a window that can still change - anything touching the live
 * service day. One ingest cycle: the readings only move when a run lands, so a
 * shorter hold re-runs the aggregation over figures that have not changed. It
 * is a backstop rather than the mechanism, since a live entry is keyed by the
 * run behind it (see {@link cacheState}) and turns over as soon as one lands.
 */
export const TODAY_REVALIDATE = INGEST_INTERVAL_SEC;

/**
 * Whether the nightly aggregate has written a `DailyRouteSummary` for a
 * service date. The aggregate classifies the day's ghost readings before it
 * writes the summaries, so a summary means the day's boards are final. A range
 * match rather than an equality on the day's start instant: the stored stamp is
 * itself a service-day start, and an equality breaks the moment the boundary
 * hour moves while stored stamps still carry the old one. One indexed read,
 * cached for five minutes so a day's caches move to the long TTL within that of
 * the summary landing.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns True once the day has a summary.
 */
async function summaryExistsFor(date: string): Promise<boolean> {
  return unstable_cache(
    async () => {
      const { start, end } = nzServiceDayRange(date);
      const row = await prisma.dailyRouteSummary.findFirst({
        where: { date: { gte: start, lt: end } },
        select: { id: true },
      });
      return row !== null;
    },
    ["summary-exists", date],
    { revalidate: 300 },
  )();
}

/**
 * Whether every service day in a window is complete and summarised, so an
 * aggregation over it can be held for a week. Null stands for a window that
 * follows the live day.
 * @param range - The queried half-open window, or null.
 * @returns True when the window's result can no longer change.
 */
export async function rangeIsFinal(range: DateRange | null): Promise<boolean> {
  if (range === null || range.end > nzServiceDayRange().start) return false;
  const dates = serviceDatesInRange(range);
  if (dates.length === 0) return false;
  return (await Promise.all(dates.map(summaryExistsFor))).every(Boolean);
}

/**
 * Which cache entry a window reads, as the last key part. The Data Cache answers
 * an expired entry with its stale value and refreshes it in the background, so a
 * key reused across states serves the old state once more - on a quiet site,
 * for as long as nobody has visited. The state is in the key so that never
 * crosses a boundary:
 * - `final` once every day in the window is summarised, held for a week;
 * - `ended` for a window that is over but not yet summarised, so a board
 *   computed while the day was still running (cut off at that moment) is never
 *   served for the finished day;
 * - `open-<service date>` for a still-running window of more than one day (the
 *   current week or month), one key per service day, so the Data Cache serves
 *   the last result and refreshes it in the background once the caller's TTL
 *   passes. Keyed by run, a week-wide scan would be thrown away every couple of
 *   minutes and paid again by the next reader, for figures one run barely
 *   moves. The day in the key means a new day still starts a fresh entry;
 * - `run-<ms>` for a single live day, keyed by the ingest run behind it;
 * - `live-<n>` for a running window with no run logged yet, a new key every TTL,
 *   so the live day is never more than one TTL behind however long ago the last
 *   visit was.
 *
 * A live window is keyed by the run rather than by a clock bucket because the
 * figures only move when a run lands. A bucket turns over on a boundary that
 * has nothing to do with ingest, so a reader who arrives just after a run can
 * still be served the bucket computed just before it - which is what an open
 * tab asking for fresher numbers would get back unchanged. Keyed by the run,
 * the entry turns over exactly when there is something new behind it, and
 * holds still in between.
 * @param final - Whether every day in the window is summarised.
 * @param range - The queried half-open window, or null for a rolling live one.
 * @param liveRevalidate - TTL while the window can still change, in seconds.
 * @param now - The current time, epoch ms (injectable for tests).
 * @param lastIngestMs - The newest successful realtime run, epoch ms, or null when none is logged.
 * @returns The key part.
 */
export function cacheState(
  final: boolean,
  range: DateRange | null,
  liveRevalidate: number,
  now: number = Date.now(),
  lastIngestMs: number | null = null,
): string {
  const fixed = runIndependentState(final, range, now);
  if (fixed !== null) return fixed;
  if (lastIngestMs !== null) return `run-${lastIngestMs}`;
  return `live-${Math.floor(now / (liveRevalidate * 1000))}`;
}

/**
 * The key part for a window whose state does not depend on the ingest run, or
 * null when only the run can decide it - which is the single live day alone.
 *
 * Split out of {@link cacheState} so a caller can skip the run lookup entirely
 * for the windows that never use it. The lookup is a database read held per
 * worker thread, so it is not shared the way the aggregations themselves are:
 * asking for it on every window put an uncached read in front of every render,
 * including the current week and month, which key on the service date instead.
 * @param final - Whether every day in the window is summarised.
 * @param range - The queried half-open window, or null for a rolling live one.
 * @param now - The current time, epoch ms.
 * @returns The key part, or null when the run stamp is needed to build one.
 */
export function runIndependentState(
  final: boolean,
  range: DateRange | null,
  now: number = Date.now(),
): string | null {
  if (final) return "final";
  if (range !== null && range.end.getTime() <= now) return "ended";
  if (range !== null && serviceDatesInRange(range).length > 1) {
    return `open-${nzServiceDayString(new Date(now))}`;
  }
  return null;
}

/**
 * Cache a date-scoped aggregation. A window over completed days holds for a
 * week once every day in it is summarised: the nightly aggregate classifies
 * ghost readings some twenty hours after a day ends, and a board computed
 * before that would otherwise pin the unclassified result. Until then, and for
 * a window touching the live day, the caller's short TTL applies, and the key
 * carries the state (see {@link cacheState}) so no entry outlives the state it
 * was computed in. A week bounds staleness if a past day is ever re-ingested
 * while still covering a day's ~2-week navigable life in one computation.
 * The same flag tells the producer whether the window is classified, so its
 * pipeline can drop the unclassified magnitude guard (see
 * {@link realDeviationMatchFor}); a window mixing classified and live days
 * keeps the guard.
 * @param fn - Produces the value on a miss; receives whether the window is classified.
 * @param keyParts - Cache key, unique to the query and its window.
 * @param range - The queried half-open window, or null for a rolling live one.
 * @param liveRevalidate - TTL while the window can still change, in seconds.
 * @returns The cached or fresh value.
 */
export async function cachedForRange<T>(
  fn: (classified: boolean) => Promise<T>,
  keyParts: string[],
  range: DateRange | null,
  liveRevalidate: number,
): Promise<T> {
  const final = await rangeIsFinal(range);
  const now = Date.now();
  // Only a single live day keys on the run stamp (see runIndependentState).
  // Fetching it for every window that merely *could* change meant the current
  // week, the current month and every ended-but-unsummarised window each paid a
  // read they then discarded. The lookup is held per worker thread rather than in
  // the shared Data Cache, so a cold instance paid it before any aggregation
  // could resolve its key - one uncached round trip in front of every render.
  const lastIngestMs =
    runIndependentState(final, range, now) !== null
      ? null
      : ((await getLastIngestRun("at"))?.completedAt.getTime() ?? null);
  return unstable_cache(
    fn,
    cacheKey(keyParts, cacheState(final, range, liveRevalidate, now, lastIngestMs)),
    { revalidate: final ? COMPLETED_DAY_REVALIDATE : liveRevalidate },
  )(final);
}

/**
 * {@link cachedForRange} for one service day.
 * @param fn - Produces the value on a miss; receives whether the day is classified.
 * @param keyParts - Cache key, unique to the query and its day.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param liveRevalidate - TTL while the day can still change, in seconds.
 * @returns The cached or fresh value.
 */
export function cachedForDay<T>(
  fn: (classified: boolean) => Promise<T>,
  keyParts: string[],
  date: string,
  liveRevalidate: number,
): Promise<T> {
  return cachedForRange(fn, keyParts, nzServiceDayRange(date), liveRevalidate);
}

/**
 * The `scheduledAt` match for a stats aggregation over a window. The ingest
 * stores AT's predicted arrival for every remaining stop of a running trip and
 * revises it each poll until the vehicle passes, so a window reaching past the
 * present would count guesses for stops not yet due; the end is clipped to now.
 * Windows over completed days are returned as they are. Callers cache the live
 * day for minutes, so the clip advances with the cache.
 * @param range - UTC half-open window.
 * @returns The `$gte`/`$lt` bounds in extended JSON.
 */
export function scheduledAtWindow(range: DateRange): {
  $gte: { $date: string };
  $lt: { $date: string };
} {
  return {
    $gte: { $date: range.start.toISOString() },
    $lt: { $date: windowEnd(range).toISOString() },
  };
}

/**
 * How far a window's figures actually reach: its own end once it has passed,
 * and now while it is still open.
 *
 * One definition, because anything weighed against those figures has to stop at
 * the same instant. The cancellation penalty did not, and charged this evening's
 * cancellation against a morning's arrivals (see lib/data/rider-wait.ts).
 * @param range - UTC half-open window.
 * @returns The end of the window, clipped to now while it is open.
 */
export function windowEnd(range: DateRange): Date {
  return range.end.getTime() > Date.now() ? new Date() : range.end;
}
