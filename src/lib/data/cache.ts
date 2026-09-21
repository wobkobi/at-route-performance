// src/lib/data/cache.ts
// Cache policy for the date-scoped aggregations: when a window is final, how long it holds,
// and the live-day clip on scheduledAt.
import { prisma } from "@/lib/db";
import { realDeviationMatchFor } from "@/lib/deviation";
import { getLastIngestRun, INGEST_INTERVAL_SEC } from "@/lib/ingest-run";
import { unstable_cache } from "@/lib/mem-cache";
import { type DateRange, nzServiceDayRange, serviceDatesInRange } from "@/lib/time";

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
 * - `run-<ms>` for a window still running, keyed by the ingest run behind it;
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
  if (final) return "final";
  if (range !== null && range.end.getTime() <= now) return "ended";
  if (lastIngestMs !== null) return `run-${lastIngestMs}`;
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
  // Only a window that can still change needs the run stamp, and the lookup is
  // held in process for a fraction of the ingest cadence, so this costs a read
  // per worker per twenty seconds rather than one per board.
  const lastIngestMs = final
    ? null
    : ((await getLastIngestRun("at"))?.completedAt.getTime() ?? null);
  return unstable_cache(
    fn,
    [...keyParts, cacheState(final, range, liveRevalidate, Date.now(), lastIngestMs)],
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
  const end = range.end.getTime() > Date.now() ? new Date() : range.end;
  return { $gte: { $date: range.start.toISOString() }, $lt: { $date: end.toISOString() } };
}
