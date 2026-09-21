// src/lib/data/rankings.ts
// Per-route rankings over a window: summaries for rolled-up days, live scans for the rest.
import {
  cachedForDay,
  cachedForRange,
  rangeIsFinal,
  scheduledAtWindow,
  toIso,
} from "@/lib/data/cache";
import { getRouteRiderWait } from "@/lib/data/rider-wait";
import { prisma, runCommand } from "@/lib/db";
import { NO_DELAY_SOURCE, realDeviationExprFor, realDeviationMatchFor } from "@/lib/deviation";
import { unstable_cache } from "@/lib/mem-cache";
import {
  earlyTwoCounts,
  lateSum,
  onTimeTwoCounts,
  pickEarlyByRouteMode,
  pickOnTimeByRouteMode,
} from "@/lib/on-time";
import { applyRoutePenalties } from "@/lib/rider-wait";
import { foldLineageRows } from "@/lib/route-lineage";
import {
  type DateRange,
  nzServiceDayRange,
  nzServiceDayString,
  nzWeekRange,
  serviceDatesInRange,
} from "@/lib/time";
import type { TopRouteRow } from "@/types/api";

/** Parameters for {@link getTopRoutes}. */
export interface TopRoutesParams {
  week?: string;
  limit: number;
  metric: "on_time_rate" | "avg_delay";
  thresholdSec: number;
  mode?: "BUS" | "TRAIN" | "FERRY";
}

/**
 * The Auckland-local week window for an ISO week string, defaulting to the
 * week containing now. ISO week 1 is the week holding 4 January; the target
 * week's Monday is stepped from there as a date and handed to
 * {@link nzWeekRange}, so the window runs from Auckland midnight rather than
 * UTC midnight (twelve or thirteen hours late for a New Zealand week).
 * @param iso - ISO week like `2025-W32` (optional).
 * @returns The week as a half-open UTC window.
 */
function isoWeekRange(iso?: string): DateRange {
  const parts = iso?.match(/^(\d{4})-W(\d{1,2})$/);
  if (!parts) return nzWeekRange();
  const [, yearPart = "", weekPart = ""] = parts;
  const jan4 = new Date(Date.UTC(Number(yearPart), 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 7 * (Number(weekPart) - 1));
  return nzWeekRange(monday.toISOString().slice(0, 10));
}

/**
 * Run the top-routes aggregation against MongoDB.
 * @param p - Validated query parameters.
 * @returns Ranked route rows.
 */
async function queryTopRoutes(p: TopRoutesParams): Promise<TopRouteRow[]> {
  const { start, end } = isoWeekRange(p.week);
  const classified = await rangeIsFinal({ start, end });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any[] = [
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
      route_id: { $toString: "$_id" },
      short_name: "$route.shortName",
      long_name: "$route.longName",
      mode: "$route.mode",
      events: 1,
      avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
      avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
      on_time_pct: { $round: ["$on_time_pct", 1] },
    },
  });

  const result = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: pipeline as never,
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as { cursor: { firstBatch: TopRouteRow[] } };

  // One row per line: a republish or the CRL cutover inside the week would
  // otherwise list the same line twice. The fold can only shorten the list
  // and shift a merged row, so re-apply the metric order.
  const metric = p.metric === "avg_delay" ? "avg_delay_sec" : "on_time_pct";
  return foldLineageRows(result.cursor.firstBatch).sort(
    (a, b) => (b[metric] ?? Number.NEGATIVE_INFINITY) - (a[metric] ?? Number.NEGATIVE_INFINITY),
  );
}

/**
 * Top routes for an ISO week, ranked by on-time rate or average delay.
 * Cached (weekly aggregates are stable); both the home page and the API route
 * call this so there is no in-process HTTP round-trip.
 * @param p - Validated query parameters.
 * @returns Ranked route rows.
 */
export async function getTopRoutes(p: TopRoutesParams): Promise<TopRouteRow[]> {
  return unstable_cache(
    () => queryTopRoutes(p),
    ["top-routes", p.week ?? "", String(p.limit), p.metric, String(p.thresholdSec), p.mode ?? ""],
    { revalidate: 3600 },
  )();
}

/**
 * Per-route aggregated rows from `DailyRouteSummary`. Per-day stats are weighted
 * by event count so the multi-day average is correct. Returns empty when no
 * summaries exist for the window (e.g. the current service day hasn't been
 * aggregated yet).
 * @param range - UTC half-open window.
 * @returns Rows for every route with at least one summary in the window.
 */
async function querySummaryRankings(range: DateRange): Promise<TopRouteRow[]> {
  // A summary row for the current service day would be a mid-day snapshot;
  // the live day is always read from ArrivalEvent (see queryRankings).
  const end = new Date(Math.min(range.end.getTime(), nzServiceDayRange().start.getTime()));
  const result = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "DailyRouteSummary",
      pipeline: [
        {
          $match: {
            date: {
              $gte: { $date: range.start.toISOString() },
              $lt: { $date: end.toISOString() },
            },
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
            route_id: { $toString: "$_id" },
            short_name: "$route.shortName",
            long_name: "$route.longName",
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
      ] as never,
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as { cursor: { firstBatch: TopRouteRow[] } };
  return result.cursor.firstBatch;
}

/**
 * Per-route aggregated rows scanned live from `ArrivalEvent`. Slower than
 * {@link querySummaryRankings} but always reflects the current service day.
 * Used as a fallback when today's `DailyRouteSummary` hasn't been written yet.
 * @param range - UTC half-open window.
 * @returns Rows for every route with at least one qualifying event in the window.
 */
async function queryLiveRankings(range: DateRange): Promise<TopRouteRow[]> {
  // Inline real-reading condition used for the weighted sums. The total `events`
  // count includes every row so no route falls below the rankings threshold;
  // delay averages use only the readings the nightly pass kept. Only days
  // without a summary reach this scan, so the window is never classified and
  // the magnitude guard stays on.
  const plausible = realDeviationExprFor(false);
  const result = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: [
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
            route_id: { $toString: "$_id" },
            short_name: "$route.shortName",
            long_name: "$route.longName",
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
      ] as never,
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as { cursor: { firstBatch: TopRouteRow[] } };
  return result.cursor.firstBatch;
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
  const res = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "DailyRouteSummary",
      pipeline: [
        {
          $match: {
            date: {
              $gte: { $date: range.start.toISOString() },
              $lt: { $date: range.end.toISOString() },
            },
          },
        },
        { $group: { _id: "$date" } },
      ] as never,
      cursor: {},
    }),
  )) as unknown as { cursor: { firstBatch: { _id: { $date: string } | string }[] } };
  const today = nzServiceDayString();
  const dates = res.cursor.firstBatch.map((r) => nzServiceDayString(new Date(toIso(r._id))));
  return new Set(dates.filter((date) => date < today));
}

/**
 * Live per-route rows for one service day, cached under the day so every
 * window that covers the day shares one aggregation. Completed days hold for a
 * week; the live day refreshes every five minutes.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns Per-route rows for that day.
 */
function cachedLiveRankingsOfDay(date: string): Promise<TopRouteRow[]> {
  return cachedForDay(
    () => queryLiveRankings(nzServiceDayRange(date)),
    ["live-rankings-day", date],
    date,
    300,
  );
}

/**
 * Per-route aggregated rows for an arbitrary window: `DailyRouteSummary` rows
 * for the service days the nightly aggregate has covered, plus a live
 * `ArrivalEvent` scan of each remaining day that has started (today, and any
 * earlier day whose aggregate has not run), merged by event weight and folded
 * to one row per line (see {@link foldLineageRows}). A window that is entirely
 * summarised costs one query; a window reaching into today costs one more,
 * cached per day. Days that have not started are skipped. Each route's
 * cancellations then join its figures as the wait for the next trip (see
 * lib/rider-wait.ts), so a route cannot improve its numbers by cancelling runs.
 * @param range - UTC half-open window.
 * @returns Per-route rows.
 */
async function queryRankings(range: DateRange): Promise<TopRouteRow[]> {
  const summarised = await summaryDatesIn(range);
  const now = new Date();
  const liveDates = serviceDatesInRange(range).filter(
    (date) => !summarised.has(date) && nzServiceDayRange(date).start <= now,
  );
  const [penalties, summaryRows, ...liveSets] = await Promise.all([
    getRouteRiderWait(range),
    summarised.size > 0 ? querySummaryRankings(range) : Promise.resolve<TopRouteRow[]>([]),
    ...liveDates.map(cachedLiveRankingsOfDay),
  ]);
  return applyRoutePenalties(foldLineageRows([...summaryRows, ...liveSets.flat()]), penalties);
}

/**
 * Cached per-route rows for a window, keyed by the window's state so a live
 * window is never served more than one TTL behind (see cachedForRange).
 * @param range - UTC half-open window.
 * @param thresholdSec - On-time threshold in seconds.
 * @param revalidate - Cache TTL in seconds while the window can still change.
 * @returns Per-route rows.
 */
export async function getRankings(
  range: DateRange,
  thresholdSec: number,
  revalidate: number,
): Promise<TopRouteRow[]> {
  return cachedForRange(
    () => queryRankings(range),
    ["rankings-v2", range.start.toISOString(), range.end.toISOString(), String(thresholdSec)],
    range,
    revalidate,
  );
}
