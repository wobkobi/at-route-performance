// src/lib/data/rankings.ts
// Per-route rankings over a window: summaries for rolled-up days, live scans for the rest.
import {
  cachedForDay,
  cachedForRange,
  dayEntryRevalidate,
  scheduledAtWindow,
} from "@/lib/data/cache";
import { aggregateRows, dateWindow, toIso } from "@/lib/data/raw";
import { PERIOD_REVALIDATE } from "@/lib/data/revalidate";
import { getRouteRiderWait } from "@/lib/data/rider-wait";
import { NO_DELAY_SOURCE, realDeviationExprFor, realDeviationMatchFor } from "@/lib/deviation";
import type { Mode } from "@/lib/mode";
import {
  earlyTwoCounts,
  lateSum,
  onTimeTwoCounts,
  pickEarlyByRouteMode,
  pickOnTimeByRouteMode,
} from "@/lib/on-time";
import { applyRoutePenalties } from "@/lib/rider-wait";
import { foldLineageRows } from "@/lib/route/lineage";
import {
  type DateRange,
  mondayOf,
  nzServiceDayRange,
  nzServiceDayString,
  nzWeekRange,
  shiftDays,
  startedServiceDates,
} from "@/lib/time/service-day";
import type { RouteRow } from "@/types/api";

/** Parameters for {@link getTopRoutes}. */
export interface TopRoutesParams {
  week?: string;
  limit: number;
  metric: "on_time_rate" | "avg_delay";
  mode?: Mode;
}

/**
 * The Auckland-local week window for an ISO week string, defaulting to the
 * week containing now. ISO week 1 is the week holding 4 January; the target
 * week's Monday is stepped from there as a date and handed to
 * {@link nzWeekRange}, so the window runs from the Monday's 4am service-day
 * start in Auckland rather than UTC midnight (well into a New Zealand Monday).
 * @param iso - ISO week like `2025-W32` (optional).
 * @returns The week as a half-open UTC window.
 */
function isoWeekRange(iso?: string): DateRange {
  const parts = iso?.match(/^(\d{4})-W(\d{1,2})$/);
  if (!parts) return nzWeekRange();
  const [, yearPart = "", weekPart = ""] = parts;
  const week1 = mondayOf(`${yearPart}-01-04`);
  return nzWeekRange(shiftDays(week1, 7 * (Number(weekPart) - 1)));
}

/**
 * Run the top-routes aggregation against MongoDB.
 * @param p - Validated query parameters.
 * @param range - The week's window.
 * @param classified - Whether every arrival in the week has been classified.
 * @returns Ranked route rows.
 */
async function queryTopRoutes(
  p: TopRoutesParams,
  range: DateRange,
  classified: boolean,
): Promise<RouteRow[]> {
  const { start, end } = range;

  const pipeline: object[] = [
    {
      $match: {
        scheduledAt: scheduledAtWindow({ start, end }),
        // This board drops ghost rows at the match rather than guarding each
        // counter, and that difference is deliberate: its `events` is only the
        // row count behind the rate it shows, never a rankings threshold. The
        // day boards keep every row in `events` and guard the counters instead
        // (see dailySummaryPipeline). The two shapes agree on every rate and
        // differ only in what `events` means.
        ...realDeviationMatchFor(classified),
      },
    },
    {
      $group: {
        _id: "$routeId",
        events: { $sum: 1 },
        avg_delay_sec: { $avg: "$deviationSec" },
        avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
        ...onTimeTwoCounts(),
      },
    },
    {
      $lookup: {
        from: "Route",
        localField: "_id",
        foreignField: "_id",
        as: "route",
      },
    },
    { $unwind: "$route" },
    // Mode known after the lookup: pick the matching on-time count, then the rate.
    { $addFields: { on_time_count: pickOnTimeByRouteMode } },
    {
      $addFields: {
        on_time_pct: { $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] },
      },
    },
  ];

  if (p.mode) pipeline.push({ $match: { "route.mode": p.mode } });

  pipeline.push({
    $sort: p.metric === "avg_delay" ? { avg_delay_sec: -1 as const } : { on_time_pct: -1 as const },
  });
  pipeline.push({ $limit: p.limit });
  pipeline.push({
    $project: {
      _id: 0,
      routeId: { $toString: "$_id" },
      shortName: "$route.shortName",
      longName: "$route.longName",
      mode: "$route.mode",
      events: 1,
      avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
      avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
      on_time_pct: { $round: ["$on_time_pct", 1] },
    },
  });

  const result = await aggregateRows<RouteRow>("ArrivalEvent", pipeline);

  // One row per line: a republish or the CRL cutover inside the week would
  // otherwise list the same line twice. The fold can only shorten the list
  // and shift a merged row, so re-apply the metric order.
  const metric = p.metric === "avg_delay" ? "avg_delay_sec" : "on_time_pct";
  return foldLineageRows(result).sort(
    (a, b) => (b[metric] ?? Number.NEGATIVE_INFINITY) - (a[metric] ?? Number.NEGATIVE_INFINITY),
  );
}

/**
 * Top routes for an ISO week, ranked by on-time rate or average delay, for
 * `/api/routes/top`. Cached by the week's state like every other window: an
 * hour while the week can still change, then for good.
 * @param p - Validated query parameters.
 * @returns Ranked route rows.
 */
export async function getTopRoutes(p: TopRoutesParams): Promise<RouteRow[]> {
  const range = isoWeekRange(p.week);
  return cachedForRange(
    (classified) => queryTopRoutes(p, range, classified),
    [
      "top-routes",
      range.start.toISOString(),
      range.end.toISOString(),
      String(p.limit),
      p.metric,
      p.mode ?? "all",
    ],
    range,
    PERIOD_REVALIDATE,
  );
}

/**
 * Per-route aggregated rows from `DailyRouteSummary`. Per-day stats are weighted
 * by event count so the multi-day average is correct. Returns empty when no
 * summaries exist for the window (e.g. the current service day hasn't been
 * aggregated yet).
 * @param range - UTC half-open window.
 * @returns Rows for every route with at least one summary in the window.
 */
async function querySummaryRankings(range: DateRange): Promise<RouteRow[]> {
  // A summary row for the current service day would be a mid-day snapshot;
  // the live day is always read from ArrivalEvent (see queryRankings).
  const end = new Date(Math.min(range.end.getTime(), nzServiceDayRange().start.getTime()));
  const result = await aggregateRows<RouteRow>("DailyRouteSummary", [
    {
      $match: {
        date: dateWindow({ start: range.start, end }),
      },
    },
    {
      $group: {
        _id: "$routeId",
        events: { $sum: "$events" },
        w_delay: { $sum: { $multiply: [{ $ifNull: ["$avgDelaySec", 0] }, "$events"] } },
        w_abs: { $sum: { $multiply: [{ $ifNull: ["$avgAbsDelaySec", 0] }, "$events"] } },
        w_on_time: { $sum: { $multiply: [{ $ifNull: ["$onTimePct", 0] }, "$events"] } },
        w_early: { $sum: { $multiply: [{ $ifNull: ["$earlyPct", 0] }, "$events"] } },
        w_late: { $sum: { $multiply: [{ $ifNull: ["$latePct", 0] }, "$events"] } },
      },
    },
    { $lookup: { from: "Route", localField: "_id", foreignField: "_id", as: "route" } },
    { $unwind: "$route" },
    {
      $project: {
        _id: 0,
        routeId: { $toString: "$_id" },
        shortName: "$route.shortName",
        longName: "$route.longName",
        mode: "$route.mode",
        events: 1,
        // Guard the divisor as the live path does: Mongo throws on a zero
        // divisor, so one stored row with events 0 would fail the whole page.
        avg_delay_sec: { $round: [{ $divide: ["$w_delay", { $max: [1, "$events"] }] }, 1] },
        avg_abs_delay_sec: { $round: [{ $divide: ["$w_abs", { $max: [1, "$events"] }] }, 1] },
        on_time_pct: { $round: [{ $divide: ["$w_on_time", { $max: [1, "$events"] }] }, 1] },
        early_pct: { $round: [{ $divide: ["$w_early", { $max: [1, "$events"] }] }, 1] },
        late_pct: { $round: [{ $divide: ["$w_late", { $max: [1, "$events"] }] }, 1] },
        colour: "$route.colour",
      },
    },
  ]);
  return result;
}

/**
 * Per-route aggregated rows scanned live from `ArrivalEvent`. Slower than
 * {@link querySummaryRankings} but always reflects the current service day.
 * Used as a fallback when today's `DailyRouteSummary` hasn't been written yet.
 * @param range - UTC half-open window.
 * @returns Rows for every route with at least one qualifying event in the window.
 */
async function queryLiveRankings(range: DateRange): Promise<RouteRow[]> {
  // Inline real-reading condition used for the weighted sums. The total `events`
  // count includes every row so no route falls below the rankings threshold;
  // delay averages use only the readings the nightly pass kept. Only days
  // without a summary reach this scan, so the window is never classified and
  // the magnitude guard stays on.
  const plausible = realDeviationExprFor(false);
  const result = await aggregateRows<RouteRow>("ArrivalEvent", [
    {
      $match: {
        scheduledAt: scheduledAtWindow(range),
        source: { $ne: NO_DELAY_SOURCE },
        // No deviation filter here: every event counted so ghost-run noise
        // does not hide a route from rankings.
      },
    },
    {
      $group: {
        _id: "$routeId",
        events: { $sum: 1 },
        // Plausible-event count used as denominator for delay averages so
        // ghost runs do not skew the mean.
        _plausible: { $sum: { $cond: [plausible, 1, 0] } },
        w_delay: { $sum: { $cond: [plausible, "$deviationSec", 0] } },
        w_abs: { $sum: { $cond: [plausible, { $abs: "$deviationSec" }, 0] } },
        ...onTimeTwoCounts(plausible),
        ...earlyTwoCounts(plausible),
        late_count: lateSum(plausible),
      },
    },
    { $lookup: { from: "Route", localField: "_id", foreignField: "_id", as: "route" } },
    { $unwind: "$route" },
    { $addFields: { on_time_count: pickOnTimeByRouteMode, early_count: pickEarlyByRouteMode } },
    {
      $project: {
        _id: 0,
        routeId: { $toString: "$_id" },
        shortName: "$route.shortName",
        longName: "$route.longName",
        mode: "$route.mode",
        colour: "$route.colour",
        events: 1,
        avg_delay_sec: {
          $round: [{ $divide: ["$w_delay", { $max: [1, "$_plausible"] }] }, 1],
        },
        avg_abs_delay_sec: {
          $round: [{ $divide: ["$w_abs", { $max: [1, "$_plausible"] }] }, 1],
        },
        on_time_pct: {
          $round: [
            { $multiply: [{ $divide: ["$on_time_count", { $max: [1, "$_plausible"] }] }, 100] },
            1,
          ],
        },
        early_pct: {
          $round: [
            { $multiply: [{ $divide: ["$early_count", { $max: [1, "$_plausible"] }] }, 100] },
            1,
          ],
        },
        late_pct: {
          $round: [
            { $multiply: [{ $divide: ["$late_count", { $max: [1, "$_plausible"] }] }, 100] },
            1,
          ],
        },
      },
    },
  ]);
  return result;
}

/**
 * Service dates inside a window that already have a `DailyRouteSummary`, read
 * from the summary date index. The current service day is never counted even
 * when a summary row exists for it: a summary written mid-day is a snapshot,
 * and the live day must stay live.
 * @param range - UTC half-open window.
 * @returns The summarised service dates (`YYYY-MM-DD`).
 */
async function summaryDatesIn(range: DateRange): Promise<Set<string>> {
  const res = await aggregateRows<{ _id: { $date: string } | string }>("DailyRouteSummary", [
    {
      $match: {
        date: dateWindow(range),
      },
    },
    { $group: { _id: "$date" } },
  ]);
  const today = nzServiceDayString();
  const dates = res.map((r) => nzServiceDayString(new Date(toIso(r._id))));
  return new Set(dates.filter((date) => date < today));
}

/**
 * Live per-route rows for one service day, cached under the day so every
 * window that covers the day shares one aggregation. Completed days hold for a
 * week; the TTL while the day can change is part of the key (see
 * {@link dayEntryRevalidate}).
 * @param date - Service date (`YYYY-MM-DD`).
 * @param revalidate - TTL in seconds while the day can still change.
 * @returns Per-route rows for that day.
 */
function cachedLiveRankingsOfDay(date: string, revalidate: number): Promise<RouteRow[]> {
  return cachedForDay(
    () => queryLiveRankings(nzServiceDayRange(date)),
    ["live-rankings-day", date, String(revalidate)],
    date,
    revalidate,
  );
}

/** The summarised part of a window's rankings; plain data so the Data Cache can hold it. */
interface SummaryRankings {
  /** Service dates (`YYYY-MM-DD`) the rows cover. */
  summarised: string[];
  /** Per-route rows over those dates, before the lineage fold. */
  rows: RouteRow[];
}

/**
 * The `DailyRouteSummary` rows for the days of a window the nightly aggregate has
 * covered, with the dates they cover.
 * @param range - UTC half-open window.
 * @returns The summarised dates and their rows.
 */
async function querySummaryPart(range: DateRange): Promise<SummaryRankings> {
  const summarised = await summaryDatesIn(range);
  return {
    summarised: [...summarised],
    rows: summarised.size > 0 ? await querySummaryRankings(range) : [],
  };
}

/**
 * Per-route aggregated rows for an arbitrary window: `DailyRouteSummary` rows
 * for the service days the nightly aggregate has covered, plus a live
 * `ArrivalEvent` scan of each remaining day that has started (today, and any
 * earlier day whose aggregate has not run), merged by event weight and folded
 * to one row per line (see {@link foldLineageRows}). Each route's cancellations
 * then join its figures as the wait for the next trip (see lib/rider-wait.ts), so
 * a route cannot improve its numbers by cancelling runs. Days that have not
 * started are skipped.
 *
 * Only the summary part is cached per window, keyed by its state (see
 * {@link cachedForRange}). The live days and the cancellation penalties are read through
 * their own day entries outside it: inside, a nested `unstable_cache` skips its
 * read, so each window miss would scan every day of the window again. Today's read
 * starts beside the summary read, since today is never summarised. Folding the parts
 * together is cheap.
 * @param range - UTC half-open window.
 * @param revalidate - Cache TTL in seconds while the window can still change.
 * @returns Per-route rows.
 */
export async function getRankings(range: DateRange, revalidate: number): Promise<RouteRow[]> {
  // One clock read, so a request that crosses 4am cannot read the closing day twice.
  const now = new Date();
  const today = nzServiceDayString(now);
  const started = startedServiceDates(range, now);
  const [summary, penalties, todayRows] = await Promise.all([
    cachedForRange(
      () => querySummaryPart(range),
      ["rankings-summary", range.start.toISOString(), range.end.toISOString()],
      range,
      revalidate,
    ),
    getRouteRiderWait(range, revalidate),
    started.includes(today)
      ? cachedLiveRankingsOfDay(today, dayEntryRevalidate(today, revalidate, today))
      : Promise.resolve<RouteRow[]>([]),
  ]);
  const summarised = new Set(summary.summarised);
  const pastLive = started.filter((d) => d !== today && !summarised.has(d));
  const pastSets = await Promise.all(
    pastLive.map((d) => cachedLiveRankingsOfDay(d, dayEntryRevalidate(d, revalidate, today))),
  );
  return applyRoutePenalties(
    foldLineageRows([...summary.rows, ...todayRows, ...pastSets.flat()]),
    penalties,
  );
}
