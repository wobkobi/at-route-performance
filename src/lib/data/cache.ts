// src/lib/data/cache.ts
// Cache policy for the date-scoped aggregations: when a window is final, how long it holds,
// and the live-day clip on scheduledAt.
import { prisma } from "@/lib/db";
import { realDeviationMatchFor } from "@/lib/deviation";
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
 * Whether the nightly aggregate has written a `DailyRouteSummary` for a
 * service date. The aggregate classifies the day's ghost readings before it
 * writes the summaries, so a summary means the day's boards are final. One
 * indexed point read, cached for five minutes so a day's caches move to the
 * long TTL within that of the summary landing.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns True once the day has a summary.
 */
async function summaryExistsFor(date: string): Promise<boolean> {
  return unstable_cache(
    async () => {
      const row = await prisma.dailyRouteSummary.findFirst({
        where: { date: nzServiceDayRange(date).start },
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
 * Cache a date-scoped ArrivalEvent aggregation. A window over completed days
 * holds for a week once every day in it is summarised: the nightly aggregate
 * classifies ghost readings some twenty hours after a day ends, and a board
 * computed before that would otherwise pin the unclassified result. Until
 * then, and for a window touching the live day, the caller's short TTL
 * applies. The Data Cache judges staleness by the calling TTL, so the key
 * carries the state as well: once the summary lands the key changes and the
 * earlier entry is abandoned rather than kept fresh under the long TTL. A
 * week bounds staleness if a past day is ever re-ingested while still
 * covering a day's ~2-week navigable life in one computation.
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
  return unstable_cache(fn, [...keyParts, final ? "final" : "live"], {
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
export function scheduledAtWindow(range: DateRange): {
  $gte: { $date: string };
  $lt: { $date: string };
} {
  const end = range.end.getTime() > Date.now() ? new Date() : range.end;
  return { $gte: { $date: range.start.toISOString() }, $lt: { $date: end.toISOString() } };
}
