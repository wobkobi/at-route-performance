// src/lib/data/cache.ts
// Cache policy for the date-scoped aggregations: when a window is final, how long it holds,
// and the live-day clip on scheduledAt.
import { type BsonWindow, dateWindow } from "@/lib/data/raw";
import { COMPLETED_DAY_REVALIDATE, FIVE_MINUTE_REVALIDATE } from "@/lib/data/revalidate";
import { prisma } from "@/lib/db";
import { realDeviationMatchFor } from "@/lib/deviation";
import { unstable_cache } from "@/lib/mem-cache";
import {
  type DateRange,
  nzServiceDayRange,
  nzServiceDayString,
  serviceDatesInRange,
} from "@/lib/time/service-day";

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
    { revalidate: FIVE_MINUTE_REVALIDATE },
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
 * - `open-<service date>` for a still-running window - the live day, the
 *   current week or month - one key per service day, so the Data Cache serves
 *   the last result and refreshes it in the background once the caller's TTL
 *   passes. The day in the key means a new day still starts a fresh entry;
 * - `live-<n>` for a rolling window with no range, a new key every TTL.
 *
 * A running window keys on the day rather than on the ingest run behind it. A
 * run lands every couple of minutes, and a key that turned over with each one
 * left nothing stale to serve: on a quiet site almost every reader was the first
 * after a run and waited out the whole aggregation. Keyed by day, a reader gets
 * the last result at once, at most one TTL behind, and the refresh happens
 * behind them.
 * @param final - Whether every day in the window is summarised.
 * @param range - The queried half-open window, or null for a rolling live one.
 * @param liveRevalidate - TTL while the window can still change, in seconds.
 * @param now - The current time, epoch ms (injectable for tests).
 * @returns The key part.
 */
export function cacheState(
  final: boolean,
  range: DateRange | null,
  liveRevalidate: number,
  now: number = Date.now(),
): string {
  if (final) return "final";
  if (range !== null && range.end.getTime() <= now) return "ended";
  if (range !== null) return `open-${nzServiceDayString(new Date(now))}`;
  return `live-${Math.floor(now / (liveRevalidate * 1000))}`;
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
  return unstable_cache(fn, cacheKey(keyParts, cacheState(final, range, liveRevalidate)), {
    revalidate: final ? COMPLETED_DAY_REVALIDATE : liveRevalidate,
  })(final);
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
export function scheduledAtWindow(range: DateRange): BsonWindow {
  return dateWindow({ start: range.start, end: windowEnd(range) });
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
