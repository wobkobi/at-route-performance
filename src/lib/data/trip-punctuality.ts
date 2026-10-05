// src/lib/data/trip-punctuality.ts
// AT's trip measures per route over a window: the tallies the nightly rollup stored on each
// past day, plus a live judgement of every day that has started but carries no stored tallies.
import { DAY_MARKER, tripPunctualityOfDay } from "@/lib/cron/trip-punctuality";
import { cachedForDay, cachedForRange } from "@/lib/data/cache";
import { aggregateRows, dateWindow, toIso, type BsonDate } from "@/lib/data/raw";
import { LIVE_DAY_REVALIDATE } from "@/lib/data/revalidate";
import { readFallback } from "@/lib/db";
import { predecessorSlugs } from "@/lib/route/lineage";
import { routeSlug } from "@/lib/route/slug";
import {
  nzServiceDayRange,
  nzServiceDayString,
  serviceDatesInRange,
  type DateRange,
} from "@/lib/time/service-day";
import { addCounts, emptyCounts, sumCounts, type PunctualityCounts } from "@/lib/trip/punctuality";

/** Tallies keyed by versioned route id; a plain object so the Data Cache can hold it. */
export type RoutePunctuality = Record<string, PunctualityCounts>;

/** The stored part of a window's tallies. */
interface StoredPunctuality {
  /** Tallies per route id. */
  byRoute: RoutePunctuality;
  /** Service dates (`YYYY-MM-DD`) with at least one tallied row. */
  dates: Set<string>;
}

/**
 * The stored tallies over a window, summed per route, and the days they cover. Only days
 * carrying the {@link DAY_MARKER} row count as stored: the writer adds it after every route's
 * row has landed, so a day whose write failed part way is judged live instead of read half
 * full. Two reads, the marked days first, then the routes' rows on just those days. The
 * current service day is never read here, since a row for it would be a mid-day snapshot.
 * @param range - UTC half-open window.
 * @returns Tallies per route id and the tallied service dates.
 */
async function storedPunctuality(range: DateRange): Promise<StoredPunctuality> {
  const end = new Date(Math.min(range.end.getTime(), nzServiceDayRange().start.getTime()));
  if (end <= range.start) return { byRoute: {}, dates: new Set() };
  const marks = await aggregateRows<{ date: BsonDate }>("DailyTripTally", [
    { $match: { date: dateWindow({ start: range.start, end }), routeId: DAY_MARKER } },
    { $project: { _id: 0, date: 1 } },
  ]);
  if (marks.length === 0) return { byRoute: {}, dates: new Set() };
  const rows = await aggregateRows<PunctualityCounts & { _id: string }>("DailyTripTally", [
    {
      $match: {
        date: { $in: marks.map((m) => ({ $date: toIso(m.date) })) },
        routeId: { $ne: DAY_MARKER },
      },
    },
    {
      $group: {
        _id: "$routeId",
        departed: { $sum: "$departed" },
        reliable: { $sum: "$reliable" },
        timed: { $sum: "$timed" },
        punctual: { $sum: "$punctual" },
        cancelled: { $sum: "$cancelled" },
      },
    },
  ]);
  return {
    byRoute: Object.fromEntries(
      rows.map(({ _id, departed, reliable, timed, punctual, cancelled }) => [
        _id,
        { departed, reliable, timed, punctual, cancelled },
      ]),
    ),
    dates: new Set(marks.map((m) => nzServiceDayString(new Date(toIso(m.date))))),
  };
}

/**
 * One untallied day's tallies, judged from the raw arrivals and cached under the day so
 * every window covering it shares the work. The live day refreshes every five minutes.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns Tallies per route id.
 */
function liveDayPunctuality(date: string): Promise<RoutePunctuality> {
  return cachedForDay(
    async () => Object.fromEntries(await tripPunctualityOfDay(date)),
    ["trip-punctuality-day", date],
    date,
    LIVE_DAY_REVALIDATE,
  );
}

/**
 * Per-route tallies for a window, the stored and live parts merged. Which days are stored
 * is decided by the tallies themselves: a day the rollup has not yet tallied, or whose
 * tally write did not finish, is judged live like today, which is always live.
 * @param range - UTC half-open window.
 * @returns Tallies per route id.
 */
async function queryTripPunctuality(range: DateRange): Promise<RoutePunctuality> {
  const stored = await storedPunctuality(range);
  const now = new Date();
  const liveDates = serviceDatesInRange(range).filter(
    (date) => !stored.dates.has(date) && nzServiceDayRange(date).start <= now,
  );
  const parts = [stored.byRoute, ...(await Promise.all(liveDates.map(liveDayPunctuality)))];
  const out: RoutePunctuality = {};
  for (const part of parts) {
    for (const [routeId, c] of Object.entries(part)) addCounts((out[routeId] ??= emptyCounts()), c);
  }
  return out;
}

/**
 * Sum the tallies of every timetable version of the given routes, each CRL line's retired
 * predecessors included (see {@link predecessorSlugs}), so the trip figure covers the same
 * trips as the line's other figures.
 * @param byRoute - Tallies keyed by versioned route id.
 * @param slugs - The routes' slugs.
 * @returns The total.
 */
export function punctualityForSlugs(
  byRoute: Readonly<RoutePunctuality>,
  slugs: ReadonlySet<string>,
): PunctualityCounts {
  const lines = new Set([...slugs].flatMap((slug) => [slug, ...predecessorSlugs(slug)]));
  return sumCounts(
    byRoute,
    Object.keys(byRoute).filter((id) => lines.has(routeSlug(id))),
  );
}

/**
 * AT's trip punctuality and reliability tallies per versioned route id over a window. Sum
 * the routes a page shows with {@link punctualityForSlugs}; the shares come from `punctualPct` and
 * `reliablePct`. Whole days only: the tallies split by neither direction nor hour.
 * @param range - UTC half-open window.
 * @param revalidate - Cache TTL in seconds while the window can still change.
 * @returns Tallies per route id.
 */
export function getTripPunctuality(
  range: DateRange,
  revalidate: number,
): Promise<RoutePunctuality> {
  return cachedForRange(
    () => queryTripPunctuality(range),
    ["trip-punctuality", range.start.toISOString(), range.end.toISOString()],
    range,
    revalidate,
  );
}

/**
 * Start {@link getTripPunctuality} now and sum the routes a view shows once they are known.
 * The tallies do not depend on which routes are shown, so a page whose route list waits on
 * its rankings starts this beside them rather than after them: a cold read judges each
 * untallied day live, which would otherwise add its whole cost to the page. A failed read
 * gives null, so the figure degrades to a dash rather than failing the page.
 * @param range - UTC half-open window.
 * @param revalidate - Cache TTL in seconds while the window can still change.
 * @returns A function from the shown routes' slugs to their total, or null when the read failed.
 */
export function startTripPunctuality(
  range: DateRange,
  revalidate: number,
): (slugs: ReadonlySet<string>) => Promise<PunctualityCounts | null> {
  const tallies = getTripPunctuality(range, revalidate).catch(
    readFallback("trip-punctuality", null),
  );
  return (slugs) => tallies.then((byRoute) => byRoute && punctualityForSlugs(byRoute, slugs));
}

/**
 * {@link getTripPunctuality} summed over the given routes, for a view that knows its routes
 * up front (see {@link startTripPunctuality}).
 * @param range - UTC half-open window.
 * @param revalidate - Cache TTL in seconds while the window can still change.
 * @param slugs - The routes' slugs.
 * @returns The total, or null when the read failed.
 */
export function getTripPunctualityOf(
  range: DateRange,
  revalidate: number,
  slugs: ReadonlySet<string>,
): Promise<PunctualityCounts | null> {
  return startTripPunctuality(range, revalidate)(slugs);
}
