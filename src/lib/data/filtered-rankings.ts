// src/lib/data/filtered-rankings.ts
// Per-route rankings and cancellation counts narrowed by the home page's
// filters (lib/ranking-filters.ts): a part of the day, a kind of day and an
// area. The unfiltered window is plain getRankings; a day type is the window's
// matching days, each read as its own cached day; a part of the day reads each
// day's hours from HourlyRouteSummary, or scans the day live when it has no
// hourly rows yet (today, or a day from before the hourly rollup existed).

import { addTo } from "@/lib/collections";
import { cachedForDay, cachedForRange, scheduledAtWindow } from "@/lib/data/cache";
import { getNetworkCancelledTrips } from "@/lib/data/cancelled";
import { getRankings } from "@/lib/data/rankings";
import { aggregateRows, dateWindow } from "@/lib/data/raw";
import { getRiderWaitOfDates } from "@/lib/data/rider-wait";
import { getRouteGeography } from "@/lib/data/route-areas";
import { NO_DELAY_SOURCE, realDeviationExprFor } from "@/lib/deviation";
import {
  earlyTwoCounts,
  lateSum,
  onTimeTwoCounts,
  pickEarlyByRouteMode,
  pickOnTimeByRouteMode,
} from "@/lib/on-time";
import {
  cancellationMatches,
  hasRankingFilters,
  rowsInAreas,
  type RankingFilters,
} from "@/lib/ranking-filters";
import { applyRoutePenalties } from "@/lib/rider-wait";
import { foldLineageRows } from "@/lib/route/lineage";
import { schoolAllows, type SchoolFilter } from "@/lib/school-bus";
import { datesOfType, type DayType } from "@/lib/time/day-type";
import { NZ_TZ } from "@/lib/time/nz-tz";
import { nzServiceDayRange, serviceDatesInRange, type DateRange } from "@/lib/time/service-day";
import { hourRangeParam, hoursInRange, type HourRange } from "@/lib/time/time-of-day";
import type { RouteRow } from "@/types/api";

/**
 * Round a pipeline value to one decimal, as every ranking row is.
 * @param expr - The value's expression.
 * @returns The rounding expression.
 */
function round1Expr(expr: unknown): object {
  return { $round: [expr, 1] };
}

/**
 * A share of the real readings, in percent.
 * @param field - The count's field path.
 * @returns The percentage expression, its divisor guarded against zero.
 */
function pctOfExpr(field: string): object {
  return round1Expr({ $multiply: [{ $divide: [field, { $max: [1, "$plausible"] }] }, 100] });
}

/**
 * The route each per-route group belongs to. A route missing from the static
 * Route collection is dropped, as the unfiltered rankings drop it.
 */
const ROUTE_LOOKUP = [
  { $lookup: { from: "Route", localField: "_id", foreignField: "_id", as: "route" } },
  { $unwind: "$route" },
];

/**
 * The stage that turns per-route counts into a ranking row, shared by the
 * hourly-summary read and the live scan so the two cannot disagree. Both arrive
 * here with the route, `events`, `plausible`, the two deviation sums and the
 * three counts, the on-time and early ones already picked by mode.
 */
const ROW_PROJECT = {
  $project: {
    _id: 0,
    routeId: { $toString: "$_id" },
    shortName: "$route.shortName",
    longName: "$route.longName",
    mode: "$route.mode",
    colour: "$route.colour",
    events: 1,
    avg_delay_sec: round1Expr({ $divide: ["$sum_delay", { $max: [1, "$plausible"] }] }),
    avg_abs_delay_sec: round1Expr({ $divide: ["$sum_abs", { $max: [1, "$plausible"] }] }),
    on_time_pct: pctOfExpr("$on_time"),
    early_pct: pctOfExpr("$early"),
    late_pct: pctOfExpr("$late"),
  },
};

/**
 * Whether the nightly rollup has written hourly rows for a day.
 * @param range - The service-day window.
 * @returns True when at least one row exists.
 */
async function hasHourlyRows(range: DateRange): Promise<boolean> {
  const rows = await aggregateRows<unknown>("HourlyRouteSummary", [
    {
      $match: {
        date: dateWindow(range),
      },
    },
    { $limit: 1 },
    { $project: { _id: 1 } },
  ]);
  return rows.length > 0;
}

/**
 * One day's rows over some hours, added up from HourlyRouteSummary.
 * @param range - The service-day window.
 * @param hours - The Auckland clock hours to keep.
 * @returns Per-route rows.
 */
function hourlySummaryRows(range: DateRange, hours: number[]): Promise<RouteRow[]> {
  return aggregateRows<RouteRow>("HourlyRouteSummary", [
    {
      $match: {
        date: dateWindow(range),
        hour: { $in: hours },
      },
    },
    {
      $group: {
        _id: "$routeId",
        events: { $sum: "$events" },
        plausible: { $sum: "$plausible" },
        sum_delay: { $sum: "$sumDelaySec" },
        sum_abs: { $sum: "$sumAbsDelaySec" },
        on_time: { $sum: "$onTime" },
        early: { $sum: "$early" },
        late: { $sum: "$late" },
      },
    },
    ...ROUTE_LOOKUP,
    ROW_PROJECT,
  ]);
}

/**
 * One day's rows over some hours, scanned live from ArrivalEvent. The hour test
 * is an `$expr` and cannot use an index, but it only sees the rows the
 * `scheduledAt` bounds already let through (see route-stats.ts).
 * @param range - The service-day window.
 * @param hours - The Auckland clock hours to keep.
 * @param classified - Whether the day's ghost pass has run.
 * @returns Per-route rows.
 */
function liveHourRows(range: DateRange, hours: number[], classified: boolean): Promise<RouteRow[]> {
  const plausible = realDeviationExprFor(classified);
  return aggregateRows<RouteRow>("ArrivalEvent", [
    {
      $match: {
        scheduledAt: scheduledAtWindow(range),
        source: { $ne: NO_DELAY_SOURCE },
        $expr: { $in: [{ $hour: { date: "$scheduledAt", timezone: NZ_TZ } }, hours] },
      },
    },
    {
      $group: {
        _id: "$routeId",
        events: { $sum: 1 },
        plausible: { $sum: { $cond: [plausible, 1, 0] } },
        sum_delay: { $sum: { $cond: [plausible, "$deviationSec", 0] } },
        sum_abs: { $sum: { $cond: [plausible, { $abs: "$deviationSec" }, 0] } },
        ...onTimeTwoCounts(plausible),
        ...earlyTwoCounts(plausible),
        late: lateSum(plausible),
      },
    },
    ...ROUTE_LOOKUP,
    { $addFields: { on_time: pickOnTimeByRouteMode, early: pickEarlyByRouteMode } },
    ROW_PROJECT,
  ]);
}

/**
 * One day's rows over a part of the day, cached under the day and the hours.
 * A classified day with hourly rows reads them; any other day is scanned.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param hours - The part of the day.
 * @param revalidate - Cache TTL while the day is still under way, in seconds.
 * @returns Per-route rows, measured arrivals only.
 */
function hourRowsOfDay(date: string, hours: HourRange, revalidate: number): Promise<RouteRow[]> {
  const range = nzServiceDayRange(date);
  const hourSet = hoursInRange(hours);
  return cachedForDay(
    async (classified) =>
      classified && (await hasHourlyRows(range))
        ? hourlySummaryRows(range, hourSet)
        : liveHourRows(range, hourSet, classified),
    ["hour-rankings-day", date, hourRangeParam(hours) ?? "all"],
    date,
    revalidate,
  );
}

/**
 * The window's service dates that match the day type and have started.
 * @param range - The window.
 * @param days - The day type, or null for every day.
 * @returns The dates, oldest first.
 */
function filteredDates(range: DateRange, days: DayType | null): string[] {
  const now = new Date();
  return datesOfType(serviceDatesInRange(range), days).filter(
    (d) => nzServiceDayRange(d).start <= now,
  );
}

/**
 * Rows for a window narrowed by time of day and day type, before the area cut.
 * With a day type alone each matching day is read through {@link getRankings},
 * which already carries that day's cancellation penalty, and the days fold
 * together by event weight. With hours, each day's hours are read and the
 * penalty is rebuilt from the cancelled trips due in those hours alone, so the
 * morning peak is not charged for an evening cancellation.
 * @param range - The window.
 * @param hours - The part of the day, or null for all of it.
 * @param days - The day type, or null for every day.
 * @param revalidate - Cache TTL for a day still under way, in seconds.
 * @returns Per-route rows, one per line.
 */
async function queryFilteredRankings(
  range: DateRange,
  hours: HourRange | null,
  days: DayType | null,
  revalidate: number,
): Promise<RouteRow[]> {
  const dates = filteredDates(range, days);
  if (!hours) {
    const sets = await Promise.all(dates.map((d) => getRankings(nzServiceDayRange(d), revalidate)));
    return foldLineageRows(sets.flat());
  }
  const [penalties, ...sets] = await Promise.all([
    getRiderWaitOfDates(dates, hours),
    ...dates.map((d) => hourRowsOfDay(d, hours, revalidate)),
  ]);
  return applyRoutePenalties(foldLineageRows(sets.flat()), penalties);
}

/**
 * Per-route rows for a window under the home page's filters. With none set this
 * is {@link getRankings} itself, so the unfiltered page reads what it always has.
 * @param range - The window.
 * @param filters - The filters.
 * @param revalidate - Cache TTL while the window can still change, in seconds.
 * @returns Per-route rows that pass every filter.
 */
export async function getFilteredRankings(
  range: DateRange,
  filters: RankingFilters,
  revalidate: number,
): Promise<RouteRow[]> {
  const { hours, days, areas } = filters;
  const [rows, geography] = await Promise.all([
    hours || days
      ? cachedForRange(
          () => queryFilteredRankings(range, hours, days, revalidate),
          [
            "filtered-rankings",
            range.start.toISOString(),
            range.end.toISOString(),
            hourRangeParam(hours) ?? "all",
            days ?? "all",
          ],
          range,
          revalidate,
        )
      : getRankings(range, revalidate),
    areas.length > 0 ? getRouteGeography() : null,
  ]);
  return geography ? rowsInAreas(rows, areas, geography.areas) : rows;
}

/** Cancellation counts under the filters, in the shapes the home page shows. */
export interface FilteredCancellations {
  /** Trips cancelled under every filter, school services per the toggle. */
  total: number;
  /** The same count with school services left out, for the "+N" beside it. */
  withoutSchool: number;
  /** Route slug to its count, for the note beside each board row. */
  byRoute: Map<string, number>;
}

/**
 * Cancellation counts for a window under the home page's filters, from the
 * per-day cancelled-trip lists the Cancellations page reads. Only called with a
 * filter set; the unfiltered page keeps its own counts.
 * @param range - The window.
 * @param filters - The narrowing filters.
 * @param base - The mode and school-service filters.
 * @param base.mode - Active mode, or null for every mode.
 * @param base.schools - Which school services count.
 * @returns The counts.
 */
export async function getFilteredCancellations(
  range: DateRange,
  filters: RankingFilters,
  base: { mode: string | null; schools: SchoolFilter },
): Promise<FilteredCancellations> {
  if (!hasRankingFilters(filters)) {
    throw new Error("getFilteredCancellations needs a filter; use the unfiltered counts");
  }
  const [trips, geography] = await Promise.all([
    getNetworkCancelledTrips(range),
    filters.areas.length > 0 ? getRouteGeography() : null,
  ]);
  const routeAreas = geography?.areas ?? {};
  let total = 0;
  let withoutSchool = 0;
  const byRoute = new Map<string, number>();
  for (const t of trips) {
    if (base.mode && t.mode !== base.mode) continue;
    if (!cancellationMatches(t, filters, routeAreas)) continue;
    if (!t.school) withoutSchool++;
    if (!schoolAllows(base.schools, t.school)) continue;
    total++;
    addTo(byRoute, t.slug);
  }
  return { total, withoutSchool, byRoute };
}
