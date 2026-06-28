// src/lib/data.ts
import { fetchAll } from "@/lib/at-static";
import { prisma, runCommand } from "@/lib/db";
import { MAX_EARLY_SEC, MAX_LATE_SEC, plausibleDeviationMatch } from "@/lib/deviation";
import { unstable_cache } from "@/lib/mem-cache";
import {
  earlySingleModeSum,
  earlyTwoCounts,
  lateSum,
  onTimePerEventSum,
  onTimeSingleModeSum,
  onTimeTwoCounts,
  pickEarlyByRouteMode,
  pickOnTimeByRouteMode,
} from "@/lib/on-time";
import { routeSlug, routeVersion } from "@/lib/route-slug";
import { isSchoolBus } from "@/lib/school-bus";
import { stationId, stationName } from "@/lib/station";
import {
  nzServiceDayRange,
  nzServiceDayString,
  SERVICE_START_HOUR,
  type DateRange,
} from "@/lib/time";
import type {
  PerTripStat,
  RouteByStop,
  RouteDay,
  RouteSummary,
  StopStats,
  TopRouteRow,
  TripStop,
  TripTimeline,
} from "@/types/api";
import type {
  ModeStat,
  ShameDayStop,
  ShameOfDay,
  ShameOfWeek,
  ShameRouteOfDay,
  ShameRouteOfWeek,
  ShameRouteRow,
  ShameStop,
  ShameStopOfDay,
  ShameStopOfWeek,
  ShameStreak,
  ShameTrip,
  WorstStop,
} from "@/types/dashboard";

/**
 * Normalise an extended-JSON date (`{ $date }`) or ISO string to an ISO string.
 * `$runCommandRaw` returns dates as `{ $date }`; this flattens them.
 * @param d - An extended-JSON date or an ISO string.
 * @returns The ISO instant string.
 */
function toIso(d: { $date: string } | string): string {
  return typeof d === "string" ? d : d.$date;
}

const MS_IN_WEEK = 604_800_000;
const MS_IN_DAY = 86_400_000;

/**
 * Every AT route id sharing a slug - the same route across feed-version
 * republishes (see {@link routeSlug}) - newest version first. Lets route queries
 * aggregate over all versions (so history doesn't fragment when AT bumps the
 * suffix) and resolve a slug URL to a concrete id. Falls back to the input when
 * nothing matches, so a full id still works. Cached briefly.
 * @param slug - A version-stripped route slug (or a full route id).
 * @returns Matching route ids, newest version first (or `[slug]` when none).
 */
export async function routeIdsForSlug(slug: string): Promise<string[]> {
  return unstable_cache(
    async () => {
      const routes = await prisma.route.findMany({
        where: { OR: [{ id: slug }, { id: { startsWith: `${slug}-` } }] },
        select: { id: true },
      });
      const ids = routes
        .map((r) => r.id)
        .filter((id) => routeSlug(id) === slug)
        .sort((a, b) => routeVersion(b) - routeVersion(a));
      return ids.length > 0 ? ids : [slug];
    },
    ["route-ids-for-slug", slug],
    { revalidate: 3600 },
  )();
}

/**
 * Find the canonical version-stripped slug for a route, case-insensitively.
 * Returns the exact slug when it exists (fast path), or the slug of the first
 * case-insensitive match (for URLs typed in the wrong case), or null when no
 * route exists. Not cached - used at request time before any data fetch.
 * @param slug - A version-stripped route slug to look up.
 * @returns The canonical slug, or null when unknown.
 */
export async function findCanonicalRouteSlug(slug: string): Promise<string | null> {
  return unstable_cache(
    async () => {
      // Exact match first (indexed _id lookup); case-insensitive fallback for
      // user-typed paths like /route/nx1 -> /route/NX1.
      const exact = await prisma.route.findFirst({
        where: { OR: [{ id: slug }, { id: { startsWith: `${slug}-` } }] },
        select: { id: true },
      });
      if (exact) return routeSlug(exact.id);
      const ci = await prisma.route.findFirst({
        where: {
          OR: [
            { id: { equals: slug, mode: "insensitive" } },
            { id: { startsWith: `${slug}-`, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      return ci ? routeSlug(ci.id) : null;
    },
    ["canonical-route-slug", slug.toLowerCase()],
    { revalidate: 3600 },
  )();
}

/** Parameters for {@link getTopRoutes}. */
export interface TopRoutesParams {
  week?: string;
  limit: number;
  metric: "on_time_rate" | "avg_delay";
  thresholdSec: number;
  mode?: "BUS" | "TRAIN" | "FERRY";
}

/** Parameters for {@link getRouteStats}. */
export interface RouteStatsParams {
  routeId: string;
  from?: Date;
  to?: Date;
  thresholdSec: number;
}

/** Result shape of {@link getRouteStats}. */
export interface RouteStats {
  route: { shortName: string | null; longName: string; mode: string; colour: string | null } | null;
  summary: RouteSummary | null;
  byStop: RouteByStop[];
}

/**
 * Compute the UTC start/end for an ISO week string, defaulting to the current week.
 * @param iso - ISO week like `2025-W32` (optional).
 * @returns Start (Mon 00:00 UTC) and end (next Mon 00:00 UTC).
 */
function isoWeekRange(iso?: string): { start: Date; end: Date } {
  const now = new Date();
  let year = now.getUTCFullYear();
  let week: number | undefined;
  const m = iso?.match(/^(\d{4})-W(\d{1,2})$/);
  if (m) {
    year = parseInt(m[1], 10);
    week = parseInt(m[2], 10);
  }
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - day + 1);

  if (!week) {
    const diff = Date.now() - week1Mon.getTime();
    week = Math.floor(diff / MS_IN_WEEK) + 1;
  }
  const start = new Date(week1Mon);
  start.setUTCDate(week1Mon.getUTCDate() + 7 * (week - 1));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}

/**
 * Run the top-routes aggregation against MongoDB.
 * @param p - Validated query parameters.
 * @returns Ranked route rows.
 */
async function queryTopRoutes(p: TopRoutesParams): Promise<TopRouteRow[]> {
  const { start, end } = isoWeekRange(p.week);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any[] = [
    {
      $match: {
        scheduledAt: {
          $gte: { $date: start.toISOString() },
          $lt: { $date: end.toISOString() },
        },
        ...plausibleDeviationMatch,
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

  return result.cursor.firstBatch;
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
 * Collapse multi-platform train stations into one row per station: sum events
 * and event-weight the average delay and on-time %. Non-platform stops pass
 * through unchanged (see {@link stationId}). Keeps the per-stop table, map, and
 * line diagram from showing the same station once per platform.
 * @param rows - Per-stop rows for the window (busiest first).
 * @returns Rows with train platforms merged by station, re-sorted busiest first.
 */
function collapseStations(rows: RouteByStop[]): RouteByStop[] {
  const acc = new Map<string, { row: RouteByStop; delaySum: number; otCount: number }>();
  for (const r of rows) {
    const id = stationId(r.stop_id, r.name);
    const delaySum = (r.avg_delay_sec ?? 0) * r.events;
    const otCount = ((r.on_time_pct ?? 0) / 100) * r.events;
    const cur = acc.get(id);
    if (cur) {
      cur.row.events += r.events;
      cur.delaySum += delaySum;
      cur.otCount += otCount;
    } else {
      acc.set(id, { row: { ...r, stop_id: id, name: stationName(r.name) }, delaySum, otCount });
    }
  }
  return [...acc.values()]
    .map(({ row, delaySum, otCount }) => ({
      ...row,
      avg_delay_sec: row.events ? Math.round((delaySum / row.events) * 10) / 10 : null,
      on_time_pct: row.events ? Math.round((otCount / row.events) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.events - a.events);
}

/**
 * Run the route-stats aggregations (summary + per-stop) against MongoDB.
 * @param p - Validated parameters; window defaults to the last 7 days.
 * @returns Summary and top stops.
 */
async function queryRouteStats(p: RouteStatsParams): Promise<RouteStats> {
  const start = p.from ?? new Date(Date.now() - 7 * MS_IN_DAY);
  const end = p.to ?? new Date();

  // Resolve the slug to every version's id so the stats cover the whole route's
  // history; read metadata from the newest version.
  const routeIds = await routeIdsForSlug(p.routeId);
  const route = await prisma.route.findUnique({
    where: { id: routeIds[0] },
    select: { shortName: true, longName: true, mode: true, colour: true },
  });
  // Single route, so the mode is fixed: use its asymmetric on-time window.
  const mode = route?.mode ?? "BUS";

  const match = {
    routeId: { $in: routeIds },
    scheduledAt: {
      $gte: { $date: start.toISOString() },
      $lt: { $date: end.toISOString() },
    },
    ...plausibleDeviationMatch,
  };

  const summaryResult = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: [
        { $match: match },
        {
          $group: {
            _id: null,
            events: { $sum: 1 },
            avg_delay_sec: { $avg: "$deviationSec" },
            avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
            on_time_count: onTimeSingleModeSum(mode),
            early_count: earlySingleModeSum(mode),
            late_count: lateSum(),
          },
        },
        {
          $addFields: {
            on_time_pct: { $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] },
            early_pct: { $multiply: [{ $divide: ["$early_count", "$events"] }, 100] },
            late_pct: { $multiply: [{ $divide: ["$late_count", "$events"] }, 100] },
          },
        },
        {
          $project: {
            _id: 0,
            events: 1,
            avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
            avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
            on_time_pct: { $round: ["$on_time_pct", 1] },
            early_pct: { $round: ["$early_pct", 1] },
            late_pct: { $round: ["$late_pct", 1] },
          },
        },
      ],
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as { cursor: { firstBatch: RouteSummary[] } };

  const byStopResult = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: [
        { $match: match },
        {
          $group: {
            _id: "$stopId",
            events: { $sum: 1 },
            avg_delay_sec: { $avg: "$deviationSec" },
            on_time_count: onTimeSingleModeSum(mode),
          },
        },
        {
          $addFields: {
            on_time_pct: {
              $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100],
            },
          },
        },
        {
          $lookup: {
            from: "Stop",
            localField: "_id",
            foreignField: "_id",
            as: "stop",
          },
        },
        { $unwind: "$stop" },
        { $sort: { events: -1 as const } },
        { $limit: 200 },
        {
          $project: {
            _id: 0,
            stop_id: { $toString: "$_id" },
            name: "$stop.name",
            lat: "$stop.lat",
            lon: "$stop.lon",
            events: 1,
            avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
            on_time_pct: { $round: ["$on_time_pct", 1] },
          },
        },
      ],
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as { cursor: { firstBatch: RouteByStop[] } };

  return {
    route: route
      ? {
          shortName: route.shortName,
          longName: route.longName,
          mode: route.mode,
          colour: route.colour ?? null,
        }
      : null,
    summary: summaryResult.cursor.firstBatch[0] ?? null,
    byStop: collapseStations(byStopResult.cursor.firstBatch),
  };
}

/**
 * Summarise a route's performance over a window (defaults to the last 7 days).
 * Cached briefly; shared by the route page and the API route.
 * @param p - Validated parameters.
 * @returns Summary and top stops.
 */
export async function getRouteStats(p: RouteStatsParams): Promise<RouteStats> {
  return unstable_cache(
    () => queryRouteStats(p),
    [
      "route-stats",
      p.routeId,
      p.from?.toISOString() ?? "",
      p.to?.toISOString() ?? "",
      String(p.thresholdSec),
    ],
    { revalidate: 300 },
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
  const result = (await runCommand(() =>
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
            avg_delay_sec: { $round: [{ $divide: ["$w_delay", "$events"] }, 1] },
            avg_abs_delay_sec: { $round: [{ $divide: ["$w_abs", "$events"] }, 1] },
            on_time_pct: { $round: [{ $divide: ["$w_on_time", "$events"] }, 1] },
            early_pct: { $round: [{ $divide: ["$w_early", "$events"] }, 1] },
            late_pct: { $round: [{ $divide: ["$w_late", "$events"] }, 1] },
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
  // Inline plausibility condition used for weighted sums: ghost runs (AT reusing
  // a trip_id against a later vehicle block) report ~60 min late at every stop.
  // The total `events` count includes all events so no route falls below the
  // rankings threshold; delay averages use only the plausible subset.
  const plausible = {
    $and: [{ $gte: ["$deviationSec", -MAX_EARLY_SEC] }, { $lte: ["$deviationSec", MAX_LATE_SEC] }],
  };
  const result = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: [
        {
          $match: {
            scheduledAt: {
              $gte: { $date: range.start.toISOString() },
              $lt: { $date: range.end.toISOString() },
            },
            source: { $ne: "AT_GTFSRT_NO_DELAY" },
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
            ...onTimeTwoCounts(),
            ...earlyTwoCounts(),
            late_count: lateSum(),
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
              $round: [{ $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] }, 1],
            },
            early_pct: {
              $round: [{ $multiply: [{ $divide: ["$early_count", "$events"] }, 100] }, 1],
            },
            late_pct: {
              $round: [{ $multiply: [{ $divide: ["$late_count", "$events"] }, 100] }, 1],
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
 * Per-route aggregated rows for an arbitrary window. Tries the fast
 * `DailyRouteSummary` path first; falls back to a live `ArrivalEvent` scan when
 * no summaries exist for the window (e.g. today before the aggregate ingest runs).
 * @param range - UTC half-open window.
 * @returns Per-route rows.
 */
async function queryRankings(range: DateRange): Promise<TopRouteRow[]> {
  const rows = await querySummaryRankings(range);
  if (rows.length > 0) return rows;
  return queryLiveRankings(range);
}

/**
 * Cached per-route rows for a window.
 * @param range - UTC half-open window.
 * @param thresholdSec - On-time threshold in seconds.
 * @param revalidate - Cache TTL in seconds.
 * @returns Per-route rows.
 */
export async function getRankings(
  range: DateRange,
  thresholdSec: number,
  revalidate: number,
): Promise<TopRouteRow[]> {
  return unstable_cache(
    () => queryRankings(range),
    ["rankings", range.start.toISOString(), range.end.toISOString(), String(thresholdSec)],
    { revalidate },
  )();
}

/**
 * Per-mode aggregates for a window.
 * @param range - UTC half-open window.
 * @param thresholdSec - On-time threshold in seconds.
 * @param revalidate - Cache TTL in seconds.
 * @returns One row per mode present in the window.
 */
export async function getModeBreakdown(
  range: DateRange,
  thresholdSec: number,
  revalidate: number,
): Promise<ModeStat[]> {
  return unstable_cache(
    async () => {
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
            // Weighted totals per route first so each route counts once regardless of
            // how many daily summaries it has in the window.
            {
              $group: {
                _id: "$routeId",
                events: { $sum: "$events" },
                w_delay: { $sum: { $multiply: [{ $ifNull: ["$avgDelaySec", 0] }, "$events"] } },
                w_on_time: { $sum: { $multiply: [{ $ifNull: ["$onTimePct", 0] }, "$events"] } },
              },
            },
            { $lookup: { from: "Route", localField: "_id", foreignField: "_id", as: "route" } },
            { $unwind: "$route" },
            // Second group: roll up by mode.
            {
              $group: {
                _id: "$route.mode",
                events: { $sum: "$events" },
                w_delay: { $sum: "$w_delay" },
                w_on_time: { $sum: "$w_on_time" },
                route_count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                mode: "$_id",
                events: 1,
                avg_delay_sec: { $round: [{ $divide: ["$w_delay", "$events"] }, 1] },
                on_time_pct: { $round: [{ $divide: ["$w_on_time", "$events"] }, 1] },
                route_count: 1,
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: ModeStat[] } };
      return res.cursor.firstBatch;
    },
    ["mode-breakdown", range.start.toISOString(), range.end.toISOString(), String(thresholdSec)],
    { revalidate },
  )();
}

/**
 * The most recent event's scheduled time, for empty-window fallback.
 * @returns The max `scheduledAt`, or null when there are no events.
 */
export async function getLatestEventDate(): Promise<Date | null> {
  // Full-collection $max, so cache it: the latest event only advances once per
  // ingest cycle, and this sits on the rankings page's critical path.
  const iso = await unstable_cache(
    async () => {
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [{ $group: { _id: null, maxSched: { $max: "$scheduledAt" } } }] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: { maxSched?: { $date: string } | string }[] } };
      const raw = res.cursor.firstBatch[0]?.maxSched;
      if (!raw) return null;
      return typeof raw === "string" ? raw : raw.$date;
    },
    ["latest-event-date"],
    { revalidate: 600 },
  )();
  return iso ? new Date(iso) : null;
}

/**
 * The most recent Auckland-local **service day** that has at least `minEvents`
 * events. Day-focused pages fall back to this when the current service day is
 * sparse. Events are bucketed by service day (shift back by `SERVICE_START_HOUR`
 * then truncate), so a post-midnight run counts under the day it started.
 * @param minEvents - Minimum events a service day needs to qualify.
 * @returns A Date inside that service day (its local noon), or null when empty.
 */
export async function getMostRecentDataDay(minEvents: number): Promise<Date | null> {
  const iso = await unstable_cache(
    async () => {
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            {
              $group: {
                _id: {
                  $dateTrunc: {
                    date: {
                      $dateSubtract: {
                        startDate: "$scheduledAt",
                        unit: "hour",
                        amount: SERVICE_START_HOUR,
                      },
                    },
                    unit: "day",
                    timezone: "Pacific/Auckland",
                  },
                },
                n: { $sum: 1 },
              },
            },
            { $match: { n: { $gte: minEvents } } },
            { $sort: { _id: -1 } },
            { $limit: 1 },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: { _id?: { $date: string } | string }[] } };
      const raw = res.cursor.firstBatch[0]?._id;
      if (!raw) return null;
      return typeof raw === "string" ? raw : raw.$date;
    },
    ["most-recent-data-day", String(minEvents)],
    { revalidate: 600 },
  )();
  if (!iso) return null;
  // The bucket is the service-day local midnight; +12h lands at noon within
  // the service day so nzServiceDayRange anchors on the right day.
  return new Date(new Date(iso).getTime() + 12 * 60 * 60 * 1000);
}

/**
 * The earliest Auckland-local **service day** that has at least `minEvents`
 * events. Day-focused pages use this to stop the day stepper paging back past
 * where data exists. Buckets match {@link getMostRecentDataDay} (shift back by
 * `SERVICE_START_HOUR`, then truncate), so the boundary is symmetric.
 * @param minEvents - Minimum events a service day needs to qualify.
 * @returns A Date inside that service day (its local noon), or null when empty.
 */
export async function getEarliestDataDay(minEvents: number): Promise<Date | null> {
  // Full-collection group-by-service-day, so cache it: the earliest day never
  // moves back, and day-stepper prev-page hits it on every render.
  const iso = await unstable_cache(
    async () => {
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            {
              $group: {
                _id: {
                  $dateTrunc: {
                    date: {
                      $dateSubtract: {
                        startDate: "$scheduledAt",
                        unit: "hour",
                        amount: SERVICE_START_HOUR,
                      },
                    },
                    unit: "day",
                    timezone: "Pacific/Auckland",
                  },
                },
                n: { $sum: 1 },
              },
            },
            { $match: { n: { $gte: minEvents } } },
            { $sort: { _id: 1 } },
            { $limit: 1 },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: { _id?: { $date: string } | string }[] } };
      const raw = res.cursor.firstBatch[0]?._id;
      if (!raw) return null;
      return typeof raw === "string" ? raw : raw.$date;
    },
    ["earliest-data-day", String(minEvents)],
    { revalidate: 600 },
  )();
  if (!iso) return null;
  // The bucket is the service day's local midnight; return its local noon so the
  // hour sits safely inside the service day for nzServiceDayRange.
  return new Date(new Date(iso).getTime() + 12 * 60 * 60 * 1000);
}

/**
 * Stop ids a route has actually served (recorded an arrival at) in the last
 * `days`. The route diagram uses this to drop pattern stops the route never
 * really stops at (origin termini, never-served variants, id mismatches), while
 * keeping recently-active stops that merely lack today's data. Cached hourly.
 * @param routeId - AT route id.
 * @param days - How many days back to consider a stop active (default 7).
 * @returns The set of active stop ids.
 */
export async function getRecentStopIds(routeId: string, days = 7): Promise<Set<string>> {
  const since = new Date(Date.now() - days * MS_IN_DAY);
  const ids = await unstable_cache(
    async () => {
      const routeIds = await routeIdsForSlug(routeId);
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            {
              $match: {
                routeId: { $in: routeIds },
                scheduledAt: { $gte: { $date: since.toISOString() } },
              },
            },
            { $group: { _id: "$stopId" } },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: { _id: string }[] } };
      return res.cursor.firstBatch.map((r) => r._id);
    },
    ["recent-stops", routeId, String(days), since.toISOString().slice(0, 10)],
    { revalidate: 3600 },
  )();
  return new Set(ids);
}

/** Parameters for {@link getWorstTripsOfDay}. */
export interface WorstTripsParams {
  routeId: string;
  range: DateRange;
  thresholdSec: number;
  limit?: number;
  /** How to order the runs (default "off" = most off-schedule). */
  sort?: TripSort;
}

/** Ordering for {@link getWorstTripsOfDay}. */
export type TripSort = "off" | "late" | "early" | "departure";

/** Mongo `$sort` stage for each trip ordering. */
const TRIP_SORTS: Record<TripSort, Record<string, 1 | -1>> = {
  off: { avg_abs_delay_sec: -1 },
  late: { avg_delay_sec: -1 },
  early: { avg_delay_sec: 1 },
  departure: { scheduled_start: 1 },
};

/** Raw worst-trips row before the `scheduled_start` date is normalised. */
interface WorstTripRaw extends Omit<PerTripStat, "scheduled_start"> {
  scheduled_start: { $date: string } | string;
}

/**
 * List each run (trip) of a route on a day, ordered by `sort` (default most
 * off-schedule by average absolute deviation). The signed average is kept so the
 * board can still show late/early direction. Cached briefly.
 * @param p - Route, day window, on-time threshold, optional row limit and sort.
 * @returns Per-trip rows ordered by `sort` (up to `limit`, default 50).
 */
export async function getWorstTripsOfDay(p: WorstTripsParams): Promise<PerTripStat[]> {
  const limit = p.limit ?? 50;
  const sort = p.sort ?? "off";
  return unstable_cache(
    async () => {
      const routeIds = await routeIdsForSlug(p.routeId);
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            {
              $match: {
                routeId: { $in: routeIds },
                scheduledAt: {
                  $gte: { $date: p.range.start.toISOString() },
                  $lt: { $date: p.range.end.toISOString() },
                },
                // No deviation filter here: every trip that had any event is
                // counted so the total reflects real runs, not just those within
                // the noise-free window.
              },
            },
            // Sort by time first so $first/$last within the group give the
            // chronological first/last stop, not an arbitrary document order.
            { $sort: { tripId: 1, scheduledAt: 1 } },
            {
              $group: {
                _id: "$tripId",
                vehicle_id: { $first: "$vehicleId" },
                scheduled_start: { $min: "$scheduledAt" },
                stops: { $sum: 1 },
                first_stop_id: { $first: "$stopId" },
                // Collect all deviations so stats can be computed from the
                // plausible subset only, keeping ghost-run noise out of averages.
                _delays: { $push: "$deviationSec" },
              },
            },
            {
              // Stats from plausible events only: ghost runs (AT reusing a trip_id
              // against a later vehicle block) report ~60 min late at every stop
              // and would skew per-trip averages if included.
              $addFields: {
                _ok: {
                  $filter: {
                    input: "$_delays",
                    as: "d",
                    cond: {
                      $and: [{ $gte: ["$$d", -MAX_EARLY_SEC] }, { $lte: ["$$d", MAX_LATE_SEC] }],
                    },
                  },
                },
              },
            },
            {
              $addFields: {
                avg_delay_sec: { $avg: "$_ok" },
                avg_abs_delay_sec: {
                  $avg: { $map: { input: "$_ok", as: "d", in: { $abs: "$$d" } } },
                },
                worst_delay_sec: { $max: "$_ok" },
              },
            },
            // AT issues several trip_ids for one physical run, so collapse runs that
            // share the same Auckland-local start minute and stop count into one
            // (keeping the most off-schedule). Done before the metric sort + limit so
            // the board and the Trips count reflect real runs.
            {
              $addFields: {
                _minute: {
                  $dateToString: {
                    date: "$scheduled_start",
                    format: "%Y-%m-%dT%H:%M",
                    timezone: "Pacific/Auckland",
                  },
                },
              },
            },
            { $sort: { _minute: 1, stops: -1, avg_abs_delay_sec: -1 } },
            { $group: { _id: { m: "$_minute", s: "$stops" }, doc: { $first: "$$ROOT" } } },
            { $replaceRoot: { newRoot: "$doc" } },
            { $lookup: { from: "tripMeta", localField: "_id", foreignField: "_id", as: "meta" } },
            { $unwind: { path: "$meta", preserveNullAndEmptyArrays: true } },
            { $sort: TRIP_SORTS[sort] },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                trip_id: { $toString: "$_id" },
                vehicle_id: 1,
                scheduled_start: 1,
                stops: 1,
                avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
                avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
                worst_delay_sec: 1,
                headsign: { $ifNull: ["$meta.headsign", null] },
                direction_id: { $ifNull: ["$meta.directionId", null] },
                first_stop_id: 1,
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: WorstTripRaw[] } };
      return res.cursor.firstBatch.map((t) => ({
        ...t,
        scheduled_start: toIso(t.scheduled_start),
      }));
    },
    [
      "worst-trips",
      p.routeId,
      p.range.start.toISOString(),
      p.range.end.toISOString(),
      String(limit),
      sort,
    ],
    { revalidate: 300 },
  )();
}

/** Fewest stops a run must have to qualify for the Shame board (drops flukes). */
const SHAME_MIN_STOPS = 5;

/** Raw Shame row before its `scheduled_start` date is normalised. */
interface ShameTripRaw extends Omit<
  ShameTrip,
  "scheduled_start" | "short_name" | "long_name" | "mode"
> {
  scheduled_start: { $date: string } | string;
  short_name?: string | null;
  long_name?: string | null;
  mode?: string | null;
}

/** School-service code regex (mirrors `isSchoolBus`) for the Shame filter. */
const SCHOOL_BUS_REGEX = "^S[0-9]{3}[A-Z]*$";

/** Which runs the Shame board considers - mirrors the home page's filters. */
export interface ShameFilter {
  /** Restrict to this mode; null/undefined means every mode. */
  mode?: "BUS" | "TRAIN" | "FERRY" | null;
  /** Include school services (default false, matching the home page default). */
  includeSchool?: boolean;
}

/**
 * The day's "Shame of the Day": the single most off-schedule run plus the worst
 * run of each hour, within the chosen filter. A run is ranked by its average
 * absolute deviation and attributed to the Auckland-local hour of its first
 * scheduled stop; runs shorter than {@link SHAME_MIN_STOPS} stops are excluded so
 * a stray one-stop feed sample can't top the board. The mode/school filters are
 * applied before the per-hour pick, so the worst always reflects what is shown
 * on the home page. Cached briefly.
 * @param range - The service-day window.
 * @param filter - Mode/school filters mirroring the home page.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The day's worst run and the per-hour worst list (earliest hour first).
 */
export async function getShameOfDay(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameOfDay> {
  const { mode = null, includeSchool = false } = filter;
  return unstable_cache(
    async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipeline: any[] = [
        {
          $match: {
            scheduledAt: {
              $gte: { $date: range.start.toISOString() },
              $lt: { $date: range.end.toISOString() },
            },
            ...plausibleDeviationMatch,
          },
        },
        // One row per run, with its off-schedule magnitude and owning route.
        {
          $group: {
            _id: "$tripId",
            route_id: { $first: "$routeId" },
            scheduled_start: { $min: "$scheduledAt" },
            stops: { $sum: 1 },
            avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
            avg_delay_sec: { $avg: "$deviationSec" },
            worst_delay_sec: { $max: "$deviationSec" },
          },
        },
        { $match: { stops: { $gte: SHAME_MIN_STOPS } } },
        { $lookup: { from: "Route", localField: "route_id", foreignField: "_id", as: "route" } },
        { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "tripMeta", localField: "_id", foreignField: "_id", as: "meta" } },
        { $unwind: { path: "$meta", preserveNullAndEmptyArrays: true } },
      ];
      // Apply the home page's filters *before* the per-hour pick, so the worst of
      // an hour is the worst among the runs the page would actually show.
      if (mode) pipeline.push({ $match: { "route.mode": mode } });
      if (!includeSchool) {
        pipeline.push({
          $match: {
            $expr: {
              $not: {
                $or: [
                  {
                    $regexMatch: {
                      input: { $ifNull: ["$route.shortName", ""] },
                      regex: SCHOOL_BUS_REGEX,
                    },
                  },
                  {
                    $regexMatch: {
                      input: { $ifNull: ["$route.longName", ""] },
                      regex: SCHOOL_BUS_REGEX,
                    },
                  },
                ],
              },
            },
          },
        });
      }
      pipeline.push(
        {
          $addFields: {
            hour: { $hour: { date: "$scheduled_start", timezone: "Pacific/Auckland" } },
          },
        },
        // Sort worst-first, then keep the worst run of each hour ($first after the
        // sort = the most off-schedule run in that hour).
        { $sort: { avg_abs_delay_sec: -1 } },
        {
          $group: {
            _id: "$hour",
            trip_id: { $first: { $toString: "$_id" } },
            route_id: { $first: "$route_id" },
            short_name: { $first: "$route.shortName" },
            long_name: { $first: "$route.longName" },
            mode: { $first: "$route.mode" },
            colour: { $first: "$route.colour" },
            scheduled_start: { $first: "$scheduled_start" },
            stops: { $first: "$stops" },
            avg_abs_delay_sec: { $first: "$avg_abs_delay_sec" },
            avg_delay_sec: { $first: "$avg_delay_sec" },
            worst_delay_sec: { $first: "$worst_delay_sec" },
            headsign: { $first: "$meta.headsign" },
          },
        },
        {
          $project: {
            _id: 0,
            hour: "$_id",
            trip_id: 1,
            route_id: 1,
            short_name: 1,
            long_name: 1,
            mode: 1,
            colour: 1,
            scheduled_start: 1,
            stops: 1,
            avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
            avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
            worst_delay_sec: 1,
            headsign: 1,
          },
        },
      );
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: pipeline as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: ShameTripRaw[] } };

      const hours: ShameTrip[] = res.cursor.firstBatch.map((t) => ({
        hour: t.hour,
        trip_id: t.trip_id,
        route_id: t.route_id,
        short_name: t.short_name ?? null,
        long_name: t.long_name ?? "",
        mode: t.mode ?? "BUS",
        colour: t.colour ?? null,
        scheduled_start: toIso(t.scheduled_start),
        stops: t.stops,
        avg_abs_delay_sec: t.avg_abs_delay_sec,
        avg_delay_sec: t.avg_delay_sec,
        worst_delay_sec: t.worst_delay_sec,
        headsign: t.headsign ?? null,
      }));
      // Service-day order: 5am is first, post-midnight runs (12am-4am) are last.
      hours.sort(
        (a, b) =>
          ((a.hour + 24 - SERVICE_START_HOUR) % 24) - ((b.hour + 24 - SERVICE_START_HOUR) % 24),
      );
      const worst = hours.reduce<ShameTrip | null>(
        (w, h) => (w == null || h.avg_abs_delay_sec > w.avg_abs_delay_sec ? h : w),
        null,
      );
      return { worst, hours };
    },
    [
      "shame-of-day",
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      includeSchool ? "school" : "no-school",
    ],
    { revalidate },
  )();
}

/** Threshold above which a service day is considered a "bad" shame day. */
const STREAK_THRESHOLD_SEC = 120;

/**
 * Look back over the last 7 service days (inclusive of today) and compute the
 * shame streak - how many consecutive bad days end on the current service day,
 * and whether the delays are trending up or down. Queries DailyRouteSummary
 * (pre-aggregated, fast) rather than ArrivalEvent.
 * @param currentRange - UTC half-open window for today's service day.
 * @param revalidate - Cache TTL in seconds.
 * @returns Streak count, trend, and per-day delay snapshots.
 */
export async function getShameStreak(
  currentRange: DateRange,
  revalidate: number,
): Promise<ShameStreak> {
  return unstable_cache(
    async () => {
      const sevenDaysAgo = new Date(currentRange.end.getTime() - 7 * MS_IN_DAY);
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "DailyRouteSummary",
          pipeline: [
            {
              $match: {
                date: {
                  $gte: { $date: sevenDaysAgo.toISOString() },
                  $lt: { $date: currentRange.end.toISOString() },
                },
              },
            },
            {
              $group: {
                _id: "$date",
                maxAbsDelaySec: { $max: "$avgAbsDelaySec" },
              },
            },
            { $sort: { _id: 1 } },
            {
              $project: {
                _id: 0,
                date: {
                  $dateToString: {
                    date: "$_id",
                    format: "%Y-%m-%d",
                    timezone: "Pacific/Auckland",
                  },
                },
                avgAbsDelaySec: { $round: ["$maxAbsDelaySec", 1] },
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as {
        cursor: { firstBatch: { date: string; avgAbsDelaySec: number | null }[] };
      };

      const rows = res.cursor.firstBatch;
      const recentDelays = rows.map((r) => ({
        date: r.date,
        avgAbsDelaySec: r.avgAbsDelaySec,
      }));

      // Walk backwards from the most recent day counting consecutive bad days.
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if ((rows[i].avgAbsDelaySec ?? 0) >= STREAK_THRESHOLD_SEC) {
          count++;
        } else {
          break;
        }
      }

      // Trend: compare first vs last day of the streak (requires >= 2 days).
      let trend: "worsening" | "improving" | "stable" = "stable";
      if (count >= 2) {
        const streakRows = rows.slice(rows.length - count);
        const first = streakRows[0].avgAbsDelaySec ?? 0;
        const last = streakRows[streakRows.length - 1].avgAbsDelaySec ?? 0;
        const delta = last - first;
        if (delta > 10) trend = "worsening";
        else if (delta < -10) trend = "improving";
      }

      return { count, trend, recentDelays };
    },
    ["shame-streak", currentRange.end.toISOString()],
    { revalidate },
  )();
}

/**
 * Count consecutive service days (ending today) on which `routeId` held the
 * highest average absolute delay across all routes - i.e. how many days in a
 * row this route has been "featured" as the shame of the day. Queries
 * DailyRouteSummary (pre-aggregated, fast). Returns 0 when the route was not
 * today's top, or when there is no data.
 * @param routeId - The GTFS route_id to track.
 * @param currentRange - UTC half-open window for today's service day.
 * @param revalidate - Cache lifetime in seconds.
 * @returns Number of consecutive days this route topped the shame list.
 */
export async function getShameRouteStreak(
  routeId: string,
  currentRange: DateRange,
  revalidate: number,
): Promise<number> {
  return unstable_cache(
    async () => {
      const sevenDaysAgo = new Date(currentRange.end.getTime() - 7 * MS_IN_DAY);
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "DailyRouteSummary",
          pipeline: [
            {
              $match: {
                date: {
                  $gte: { $date: sevenDaysAgo.toISOString() },
                  $lt: { $date: currentRange.end.toISOString() },
                },
              },
            },
            // Sort so that within each date the highest-delay route comes first,
            // then $first picks it up as the day's top route.
            { $sort: { date: 1, avgAbsDelaySec: -1 } },
            {
              $group: {
                _id: "$date",
                topRouteId: { $first: "$routeId" },
              },
            },
            { $sort: { _id: 1 } },
            {
              $project: {
                _id: 0,
                date: {
                  $dateToString: {
                    date: "$_id",
                    format: "%Y-%m-%d",
                    timezone: "Pacific/Auckland",
                  },
                },
                topRouteId: 1,
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as {
        cursor: { firstBatch: { date: string; topRouteId: string }[] };
      };

      const rows = res.cursor.firstBatch;
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].topRouteId === routeId) {
          count++;
        } else {
          break;
        }
      }
      return count;
    },
    ["shame-route-streak", routeId, currentRange.end.toISOString()],
    { revalidate },
  )();
}

/**
 * For each route in `routeIds`, compute its consecutive-day streak (ending
 * today) and the total number of hourly slots it was the worst route across
 * all previous streak days (today's hours are tracked separately by the caller).
 *
 * Runs one ArrivalEvent aggregation over the past 14 days: group by trip >
 * bucket by (serviceDay, hour) > pick worst route per slot > count hours per
 * (serviceDay, routeId) > collect per day. Streak breaks when a route is absent
 * from a day's shame set or when a day has no data at all.
 *
 * Today counts as day 1 by definition (caller confirms all routeIds are on
 * today's shame list). Result caps at 15 (today + 14 prior days).
 * @param routeIds - Route IDs to check (from today's shame list).
 * @param currentRange - UTC half-open window for today's service day.
 * @param filter - Mode/school filter matching the active shame page view.
 * @param filter.mode - Restrict to this mode; null means all modes.
 * @param filter.includeSchool - Include school services (default false).
 * @param revalidate - Cache lifetime in seconds.
 * @returns Map of routeId to `{ count, prevHours, prevWorstOfDayDays }` — streak
 *   length (min 1), total hourly-slot appearances across *previous* streak days,
 *   and the count of consecutive prior days on which this route was also the
 *   worst of the day (highest avg absolute delay across all slots).
 */
export async function getShameRouteStreaksBatch(
  routeIds: string[],
  currentRange: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<Map<string, { count: number; prevHours: number; prevWorstOfDayDays: number }>> {
  if (routeIds.length === 0) return new Map();
  const { mode = null, includeSchool = false } = filter;

  // Cache keyed only by day+filter, NOT by routeIds. The pipeline scans all
  // routes anyway; including routeIds in the key caused a cache miss whenever
  // the visible route set grew during the day, re-running the full 14-day
  // aggregation on every new hourly cycle.
  const firstBatch = await unstable_cache(
    async () => {
      const fourteenDaysAgo = new Date(currentRange.start.getTime() - 14 * MS_IN_DAY);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipeline: any[] = [
        {
          $match: {
            scheduledAt: {
              $gte: { $date: fourteenDaysAgo.toISOString() },
              $lt: { $date: currentRange.start.toISOString() },
            },
            ...plausibleDeviationMatch,
          },
        },
        // Collapse to one row per (routeId, tripId) so time buckets use trip
        // start rather than individual stop times.
        {
          $group: {
            _id: { routeId: "$routeId", tripId: "$tripId" },
            trip_start: { $min: "$scheduledAt" },
            events: { $sum: 1 },
            avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
          },
        },
        // Service-day date (YYYY-MM-DD in NZ timezone) using the same
        // shift as getShameRouteOfDay so buckets match the shame page.
        {
          $addFields: {
            serviceDay: {
              $dateToString: {
                date: {
                  $dateTrunc: {
                    date: {
                      $dateSubtract: {
                        startDate: "$trip_start",
                        unit: "hour",
                        amount: SERVICE_START_HOUR,
                      },
                    },
                    unit: "day",
                    timezone: "Pacific/Auckland",
                  },
                },
                format: "%Y-%m-%d",
                timezone: "Pacific/Auckland",
              },
            },
            hour: { $hour: { date: "$trip_start", timezone: "Pacific/Auckland" } },
          },
        },
        // Group by (serviceDay, hour, routeId).
        {
          $group: {
            _id: { serviceDay: "$serviceDay", hour: "$hour", routeId: "$_id.routeId" },
            events: { $sum: "$events" },
            avg_abs_delay_sec: { $avg: "$avg_abs_delay_sec" },
          },
        },
        { $match: { events: { $gte: MIN_ROUTE_EVENTS_HOUR } } },
        // Join Route for mode and school filters.
        { $lookup: { from: "Route", localField: "_id.routeId", foreignField: "_id", as: "route" } },
        { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },
      ];

      if (mode) pipeline.push({ $match: { "route.mode": mode } });
      if (!includeSchool) {
        pipeline.push({
          $match: {
            $expr: {
              $not: {
                $or: [
                  {
                    $regexMatch: {
                      input: { $ifNull: ["$route.shortName", ""] },
                      regex: SCHOOL_BUS_REGEX,
                    },
                  },
                  {
                    $regexMatch: {
                      input: { $ifNull: ["$route.longName", ""] },
                      regex: SCHOOL_BUS_REGEX,
                    },
                  },
                ],
              },
            },
          },
        });
      }

      pipeline.push(
        // Worst-first so $first picks the most off-schedule route per slot.
        { $sort: { avg_abs_delay_sec: -1 } },
        // Pick the worst route per (serviceDay, hour); keep its delay for worst-of-day.
        {
          $group: {
            _id: { serviceDay: "$_id.serviceDay", hour: "$_id.hour" },
            worstRouteId: { $first: "$_id.routeId" },
            slotDelay: { $first: "$avg_abs_delay_sec" },
          },
        },
        // Count hourly slots and track the highest slot delay per (serviceDay, route).
        {
          $group: {
            _id: { serviceDay: "$_id.serviceDay", routeId: "$worstRouteId" },
            hourCount: { $sum: 1 },
            maxSlotDelay: { $max: "$slotDelay" },
          },
        },
        // Sort so $first in the collect group picks the route with the highest
        // single-slot delay — matching the page's worst-of-day criterion.
        { $sort: { "_id.serviceDay": 1, maxSlotDelay: -1 } },
        // Collect per-day: worst-of-day route id + array of { routeId, hourCount }.
        {
          $group: {
            _id: "$_id.serviceDay",
            worstOfDayRouteId: { $first: "$_id.routeId" },
            slots: { $push: { routeId: "$_id.routeId", hourCount: "$hourCount" } },
          },
        },
      );

      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: pipeline as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as {
        cursor: {
          firstBatch: {
            _id: string;
            worstOfDayRouteId: string;
            slots: { routeId: string; hourCount: number }[];
          }[];
        };
      };

      return res.cursor.firstBatch;
    },
    [
      "shame-route-streaks-batch-v5",
      currentRange.end.toISOString(),
      mode ?? "all",
      includeSchool ? "school" : "no-school",
    ],
    { revalidate },
  )();

  // Build lookup structures from the cached data (fast O(n), runs outside cache).
  const shameDays = new Map<string, Set<string>>();
  const routeHoursPerDay = new Map<string, Map<string, number>>();
  const worstOfDayPerDay = new Map<string, string>();
  for (const row of firstBatch) {
    const daySet = new Set<string>();
    const hourMap = new Map<string, number>();
    for (const slot of row.slots) {
      daySet.add(slot.routeId);
      hourMap.set(slot.routeId, slot.hourCount);
    }
    shameDays.set(row._id, daySet);
    routeHoursPerDay.set(row._id, hourMap);
    worstOfDayPerDay.set(row._id, row.worstOfDayRouteId);
  }

  const result = new Map<
    string,
    { count: number; prevHours: number; prevWorstOfDayDays: number }
  >();
  for (const routeId of routeIds) {
    let count = 1; // today is always day 1 (caller confirmed)
    let prevHours = 0;
    let prevWorstOfDayDays = 0;
    let expectedStart = new Date(currentRange.start.getTime() - MS_IN_DAY);
    for (let d = 0; d < 14; d++) {
      const dayKey = nzServiceDayString(expectedStart);
      const daySet = shameDays.get(dayKey);
      if (!daySet || !daySet.has(routeId)) break;
      count++;
      prevHours += routeHoursPerDay.get(dayKey)?.get(routeId) ?? 0;
      // Consecutive worst-of-day run from yesterday backwards.
      if (d === prevWorstOfDayDays && worstOfDayPerDay.get(dayKey) === routeId) {
        prevWorstOfDayDays++;
      }
      expectedStart = new Date(expectedStart.getTime() - MS_IN_DAY);
    }
    result.set(routeId, { count, prevHours, prevWorstOfDayDays });
  }
  return result;
}

/** Minimum arrival events for a route in a window to qualify for the Route Shame board. */
const MIN_ROUTE_EVENTS_HOUR = 5;

/**
 * Build the shared route-shame pipeline prefix. Groups by `(routeId, tripId)`
 * first so the time-bucket key is derived from each trip's START time (not the
 * hour of each individual stop). This prevents overnight trips from creating
 * spurious late-night slots on the shame board.
 *
 * Pipeline: match range > group by trip > add `groupKey` from trip start >
 * group by (routeId, key) > enforce min-events > join Route > mode/school filters.
 * The caller appends "pick worst per key" group and projection stages.
 * @param range - The window to query.
 * @param mode - Route mode filter (null = all).
 * @param includeSchool - Whether to include school services.
 * @param groupKey - Name of the field computed by `addFieldsStage`.
 * @param addFieldsStage - `$addFields` stage that computes `groupKey` from `$trip_start`.
 * @returns The partial pipeline array.
 */
function routeShamePipelineBase(
  range: DateRange,
  mode: string | null,
  includeSchool: boolean,
  groupKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addFieldsStage: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any[] = [
    {
      $match: {
        scheduledAt: {
          $gte: { $date: range.start.toISOString() },
          $lt: { $date: range.end.toISOString() },
        },
        ...plausibleDeviationMatch,
      },
    },
    // Collapse to one row per (routeId, tripId) so the time bucket uses trip
    // start time, not individual stop times. Overnight routes no longer bleed
    // into post-midnight hour slots they don't actually start in.
    {
      $group: {
        _id: { routeId: "$routeId", tripId: "$tripId" },
        trip_start: { $min: "$scheduledAt" },
        events: { $sum: 1 },
        avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
        avg_delay_sec: { $avg: "$deviationSec" },
      },
    },
    { $addFields: addFieldsStage },
    {
      $group: {
        _id: { routeId: "$_id.routeId", [groupKey]: `$${groupKey}` },
        events: { $sum: "$events" },
        avg_abs_delay_sec: { $avg: "$avg_abs_delay_sec" },
        avg_delay_sec: { $avg: "$avg_delay_sec" },
      },
    },
    { $match: { events: { $gte: MIN_ROUTE_EVENTS_HOUR } } },
    { $lookup: { from: "Route", localField: "_id.routeId", foreignField: "_id", as: "route" } },
    { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },
  ];
  if (mode) pipeline.push({ $match: { "route.mode": mode } });
  if (!includeSchool) {
    pipeline.push({
      $match: {
        $expr: {
          $not: {
            $or: [
              {
                $regexMatch: {
                  input: { $ifNull: ["$route.shortName", ""] },
                  regex: SCHOOL_BUS_REGEX,
                },
              },
              {
                $regexMatch: {
                  input: { $ifNull: ["$route.longName", ""] },
                  regex: SCHOOL_BUS_REGEX,
                },
              },
            ],
          },
        },
      },
    });
  }
  return pipeline;
}

/** Raw route-shame row from the aggregation cursor. */
interface ShameRouteRaw {
  hour: number;
  route_id: string;
  short_name: string | null;
  long_name: string | null;
  mode: string | null;
  colour: string | null;
  events: number;
  avg_abs_delay_sec: number;
  avg_delay_sec: number;
}

/**
 * The day's "Shame of the Day" for routes: the single most off-schedule route
 * plus the worst route of each hour. Groups `ArrivalEvent` by
 * `(routeId, hour)`, takes the worst route per hour, returns them earliest
 * hour first with the overall worst flagged. Cached at the supplied revalidate
 * rate.
 * @param range - The service-day window.
 * @param filter - Mode/school filters.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The period's worst route and the per-hour worst list.
 */
export async function getShameRouteOfDay(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameRouteOfDay> {
  const { mode = null, includeSchool = false } = filter;
  return unstable_cache(
    async () => {
      const pipeline = routeShamePipelineBase(range, mode, includeSchool, "hour", {
        hour: { $hour: { date: "$trip_start", timezone: "Pacific/Auckland" } },
      });
      pipeline.push(
        { $sort: { avg_abs_delay_sec: -1 } },
        {
          $group: {
            _id: "$_id.hour",
            route_id: { $first: "$_id.routeId" },
            short_name: { $first: "$route.shortName" },
            long_name: { $first: "$route.longName" },
            mode: { $first: "$route.mode" },
            colour: { $first: "$route.colour" },
            events: { $first: "$events" },
            avg_abs_delay_sec: { $first: "$avg_abs_delay_sec" },
            avg_delay_sec: { $first: "$avg_delay_sec" },
          },
        },
        {
          $project: {
            _id: 0,
            hour: "$_id",
            route_id: 1,
            short_name: 1,
            long_name: 1,
            mode: 1,
            colour: 1,
            events: 1,
            avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
            avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
          },
        },
      );
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: pipeline as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: ShameRouteRaw[] } };

      const hours: ShameRouteRow[] = res.cursor.firstBatch.map((r) => ({
        hour: r.hour,
        route_id: r.route_id,
        short_name: r.short_name ?? null,
        long_name: r.long_name ?? "",
        mode: r.mode ?? "BUS",
        colour: r.colour ?? null,
        events: r.events,
        avg_abs_delay_sec: r.avg_abs_delay_sec,
        avg_delay_sec: r.avg_delay_sec,
      }));
      // Service-day order: 5am is first, post-midnight runs (12am-4am) are last.
      hours.sort(
        (a, b) =>
          ((a.hour + 24 - SERVICE_START_HOUR) % 24) - ((b.hour + 24 - SERVICE_START_HOUR) % 24),
      );
      const worst = hours.reduce<ShameRouteRow | null>(
        (w, h) => (w == null || h.avg_abs_delay_sec > w.avg_abs_delay_sec ? h : w),
        null,
      );
      return { worst, hours };
    },
    [
      "shame-route-of-day-v3",
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      includeSchool ? "school" : "no-school",
    ],
    { revalidate },
  )();
}

/**
 * The week's "Shame of the Week" for routes: the single most off-schedule route
 * plus the worst route of each service day. Groups `ArrivalEvent` by
 * `(routeId, serviceDay)`. Mirrors {@link getShameRouteOfDay} but for the week
 * view. Cached at the supplied revalidate rate.
 * @param range - The week (or multi-day) window.
 * @param filter - Mode/school filters.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The period's worst route and the per-day worst list, earliest day first.
 */
export async function getShameRouteOfWeek(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameRouteOfWeek> {
  const { mode = null, includeSchool = false } = filter;
  return unstable_cache(
    async () => {
      const pipeline = routeShamePipelineBase(range, mode, includeSchool, "serviceDay", {
        serviceDay: {
          $dateTrunc: {
            date: {
              $dateSubtract: {
                startDate: "$trip_start",
                unit: "hour",
                amount: SERVICE_START_HOUR,
              },
            },
            unit: "day",
            timezone: "Pacific/Auckland",
          },
        },
      });
      pipeline.push(
        { $sort: { avg_abs_delay_sec: -1 } },
        {
          $group: {
            _id: "$_id.serviceDay",
            route_id: { $first: "$_id.routeId" },
            short_name: { $first: "$route.shortName" },
            long_name: { $first: "$route.longName" },
            mode: { $first: "$route.mode" },
            colour: { $first: "$route.colour" },
            events: { $first: "$events" },
            avg_abs_delay_sec: { $first: "$avg_abs_delay_sec" },
            avg_delay_sec: { $first: "$avg_delay_sec" },
          },
        },
        {
          $project: {
            _id: 1,
            route_id: 1,
            short_name: 1,
            long_name: 1,
            mode: 1,
            colour: 1,
            events: 1,
            avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
            avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
          },
        },
      );
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: pipeline as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as {
        cursor: { firstBatch: (Omit<ShameRouteRaw, "hour"> & { _id: unknown })[] };
      };

      const days: ShameRouteRow[] = res.cursor.firstBatch.map((r) => ({
        hour: 0,
        date: nzDateString(r._id),
        route_id: r.route_id,
        short_name: r.short_name ?? null,
        long_name: r.long_name ?? "",
        mode: r.mode ?? "BUS",
        colour: r.colour ?? null,
        events: r.events,
        avg_abs_delay_sec: r.avg_abs_delay_sec,
        avg_delay_sec: r.avg_delay_sec,
      }));
      days.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
      const worst = days.reduce<ShameRouteRow | null>(
        (w, d) => (w == null || d.avg_abs_delay_sec > w.avg_abs_delay_sec ? d : w),
        null,
      );
      return { worst, days };
    },
    [
      "shame-route-of-week-v2",
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      includeSchool ? "school" : "no-school",
    ],
    { revalidate },
  )();
}

/**
 * Format a MongoDB-returned date value (either a plain ISO string or a
 * `{ $date: "..." }` object) as an Auckland-local `YYYY-MM-DD` string without
 * the service-day hour shift. Used when the pipeline already handles that shift
 * via `$dateSubtract`.
 * @param d - Raw value from the aggregation cursor.
 * @returns Auckland-local calendar date.
 */
function nzDateString(d: unknown): string {
  const iso = typeof d === "string" ? d : ((d as { $date: string })?.$date ?? String(d));
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * Build the shared part of the shame aggregation pipeline: match by date range,
 * group to one row per trip, filter by min stops, join Route + TripMeta, then
 * apply mode/school filters. The caller appends the final hour or service-day
 * grouping.
 * @param range - The window to query.
 * @param mode - Route mode filter (null = all).
 * @param includeSchool - Whether to include school services.
 * @returns The partial aggregation pipeline array.
 */
function shamePipelineBase(
  range: DateRange,
  mode: string | null,
  includeSchool: boolean,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any[] = [
    {
      $match: {
        scheduledAt: {
          $gte: { $date: range.start.toISOString() },
          $lt: { $date: range.end.toISOString() },
        },
        ...plausibleDeviationMatch,
      },
    },
    {
      $group: {
        _id: "$tripId",
        route_id: { $first: "$routeId" },
        scheduled_start: { $min: "$scheduledAt" },
        stops: { $sum: 1 },
        avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
        avg_delay_sec: { $avg: "$deviationSec" },
        worst_delay_sec: { $max: "$deviationSec" },
      },
    },
    { $match: { stops: { $gte: SHAME_MIN_STOPS } } },
    { $lookup: { from: "Route", localField: "route_id", foreignField: "_id", as: "route" } },
    { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "tripMeta", localField: "_id", foreignField: "_id", as: "meta" } },
    { $unwind: { path: "$meta", preserveNullAndEmptyArrays: true } },
  ];
  if (mode) pipeline.push({ $match: { "route.mode": mode } });
  if (!includeSchool) {
    pipeline.push({
      $match: {
        $expr: {
          $not: {
            $or: [
              {
                $regexMatch: {
                  input: { $ifNull: ["$route.shortName", ""] },
                  regex: SCHOOL_BUS_REGEX,
                },
              },
              {
                $regexMatch: {
                  input: { $ifNull: ["$route.longName", ""] },
                  regex: SCHOOL_BUS_REGEX,
                },
              },
            ],
          },
        },
      },
    });
  }
  return pipeline;
}

/**
 * The week's "Shame of the Week": the single most off-schedule run plus the
 * worst run of each service day, within the chosen filter. Mirrors
 * {@link getShameOfDay} but groups by service day instead of hour. The service
 * day boundary is determined by subtracting {@link SERVICE_START_HOUR} hours
 * before truncating to the Auckland-local calendar day. Cached at the supplied
 * revalidate rate.
 * @param range - The week (or multi-day) window.
 * @param filter - Mode/school filters mirroring the rankings page.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The period's worst run and the per-day worst list, earliest day first.
 */
export async function getShameOfWeek(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameOfWeek> {
  const { mode = null, includeSchool = false } = filter;
  return unstable_cache(
    async () => {
      const pipeline = shamePipelineBase(range, mode, includeSchool);
      pipeline.push(
        {
          $addFields: {
            // Shift each trip back by the service-start offset then truncate to
            // Auckland-local calendar day so post-midnight trips land on the correct
            // service day.
            serviceDay: {
              $dateTrunc: {
                date: {
                  $dateSubtract: {
                    startDate: "$scheduled_start",
                    unit: "hour",
                    amount: SERVICE_START_HOUR,
                  },
                },
                unit: "day",
                timezone: "Pacific/Auckland",
              },
            },
          },
        },
        { $sort: { avg_abs_delay_sec: -1 } },
        {
          $group: {
            _id: "$serviceDay",
            trip_id: { $first: { $toString: "$_id" } },
            route_id: { $first: "$route_id" },
            short_name: { $first: "$route.shortName" },
            long_name: { $first: "$route.longName" },
            mode: { $first: "$route.mode" },
            colour: { $first: "$route.colour" },
            scheduled_start: { $first: "$scheduled_start" },
            stops: { $first: "$stops" },
            avg_abs_delay_sec: { $first: "$avg_abs_delay_sec" },
            avg_delay_sec: { $first: "$avg_delay_sec" },
            worst_delay_sec: { $first: "$worst_delay_sec" },
            headsign: { $first: "$meta.headsign" },
          },
        },
        {
          $project: {
            _id: 1,
            trip_id: 1,
            route_id: 1,
            short_name: 1,
            long_name: 1,
            mode: 1,
            colour: 1,
            scheduled_start: 1,
            stops: 1,
            avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
            avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
            worst_delay_sec: 1,
            headsign: 1,
          },
        },
      );
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: pipeline as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as {
        cursor: {
          firstBatch: (Omit<ShameTripRaw, "hour"> & { _id: unknown })[];
        };
      };

      const days: ShameTrip[] = res.cursor.firstBatch.map((t) => ({
        hour: 0,
        date: nzDateString(t._id),
        trip_id: t.trip_id,
        route_id: t.route_id,
        short_name: t.short_name ?? null,
        long_name: t.long_name ?? "",
        mode: t.mode ?? "BUS",
        colour: t.colour ?? null,
        scheduled_start: toIso(t.scheduled_start),
        stops: t.stops,
        avg_abs_delay_sec: t.avg_abs_delay_sec,
        avg_delay_sec: t.avg_delay_sec,
        worst_delay_sec: t.worst_delay_sec,
        headsign: t.headsign ?? null,
      }));
      days.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
      const worst = days.reduce<ShameTrip | null>(
        (w, d) => (w == null || d.avg_abs_delay_sec > w.avg_abs_delay_sec ? d : w),
        null,
      );
      return { worst, days };
    },
    [
      "shame-of-week",
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      includeSchool ? "school" : "no-school",
    ],
    { revalidate },
  )();
}

/** Fewest events a stop needs per hour to appear in the Stop Shame hour board. */
const MIN_STOP_EVENTS_HOUR = 5;

/** Fewest events a stop needs to qualify for the worst-stops ranking. */
const MIN_STOP_EVENTS = 20;

/** Raw worst-stop row straight from the aggregation (pre platform-collapse). */
interface WorstStopRaw {
  stop_id: string;
  name: string;
  events: number;
  avg_delay_sec: number | null;
  avg_abs_delay_sec: number;
  /** Route ids that served this stop in the window; used to resolve dominant mode. */
  routeIds: string[];
  mode: "BUS" | "TRAIN" | "FERRY"; // resolved in JS, not from the pipeline
}

/**
 * Collapse train-platform rows to one station each (summing events and
 * re-averaging both delay figures by event weight), then re-rank worst-first.
 * Mirrors {@link stationId}/{@link stationName} platform collapsing for the
 * cross-route worst-stops board so a station isn't split across its platforms.
 * @param rows - Raw per-stop rows, richest first.
 * @returns Station-collapsed rows, sorted by off-schedule magnitude descending.
 */
function collapseWorstStops(rows: WorstStopRaw[]): WorstStop[] {
  const acc = new Map<string, { row: WorstStop; absSum: number; signedSum: number }>();
  for (const r of rows) {
    const id = stationId(r.stop_id, r.name);
    const absSum = r.avg_abs_delay_sec * r.events;
    const signedSum = (r.avg_delay_sec ?? 0) * r.events;
    const cur = acc.get(id);
    if (cur) {
      cur.row.events += r.events;
      cur.absSum += absSum;
      cur.signedSum += signedSum;
      // mode already set from the first row - platforms share a mode
    } else {
      acc.set(id, {
        row: {
          stop_id: id,
          name: stationName(r.name),
          events: r.events,
          avg_delay_sec: r.avg_delay_sec,
          avg_abs_delay_sec: r.avg_abs_delay_sec,
          mode: r.mode,
        },
        absSum,
        signedSum,
      });
    }
  }
  return [...acc.values()]
    .map(({ row, absSum, signedSum }) => ({
      ...row,
      avg_abs_delay_sec: Math.round((absSum / row.events) * 10) / 10,
      avg_delay_sec: Math.round((signedSum / row.events) * 10) / 10,
    }))
    .sort((a, b) => b.avg_abs_delay_sec - a.avg_abs_delay_sec);
}

/**
 * All routes as a `routeId -> mode` map. Cached with a long TTL since routes
 * only change when GTFS is re-ingested. Used to resolve dominant mode per stop.
 * @returns Map from route id to its mode.
 */
async function getRouteModeMap(): Promise<Map<string, "BUS" | "TRAIN" | "FERRY">> {
  const pairs = await unstable_cache(
    async () => {
      const rows = await prisma.route.findMany({ select: { id: true, mode: true } });
      return rows.map((r) => [r.id, r.mode] as const);
    },
    ["route-mode-map"],
    { revalidate: 3600 },
  )();
  return new Map(pairs as [string, "BUS" | "TRAIN" | "FERRY"][]);
}

/**
 * Pick the most common mode among `routeIds`. Ties resolve BUS > TRAIN > FERRY.
 * @param routeIds - Route ids that served a stop in the window.
 * @param modeMap - The full route-mode map from {@link getRouteModeMap}.
 * @returns The dominant mode, or `"BUS"` when no routes are recognised.
 */
function dominantMode(
  routeIds: string[],
  modeMap: Map<string, "BUS" | "TRAIN" | "FERRY">,
): "BUS" | "TRAIN" | "FERRY" {
  const counts = { BUS: 0, TRAIN: 0, FERRY: 0 };
  for (const id of routeIds) {
    const m = modeMap.get(id);
    if (m) counts[m]++;
  }
  if (counts.BUS >= counts.TRAIN && counts.BUS >= counts.FERRY) return "BUS";
  if (counts.TRAIN >= counts.FERRY) return "TRAIN";
  return "FERRY";
}

/**
 * Resolve the route ids whose events the worst-stop ranking should include,
 * mirroring the home/rankings mode + school filters. Returns null when no filter
 * applies (every mode, school included), so the caller can skip the `$in` match.
 * @param mode - Restrict to this mode, or null for every mode.
 * @param includeSchool - Whether to include `S###` school services.
 * @returns Included route ids, or null when no route filter is needed.
 */
async function worstStopRouteIds(
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
): Promise<string[] | null> {
  if (!mode && includeSchool) return null;
  return unstable_cache(
    async () => {
      // Push mode filter to DB; school-bus detection needs name fields so stays in JS.
      const routes = await prisma.route.findMany({
        where: mode ? { mode } : undefined,
        select: { id: true, shortName: true, longName: true },
      });
      return routes
        .filter((r) => includeSchool || !isSchoolBus(r.shortName, r.longName))
        .map((r) => r.id);
    },
    ["worst-stop-route-ids", mode ?? "all", String(includeSchool)],
    { revalidate: 3600 },
  )();
}

/**
 * Rank stops by how far off schedule their buses ran across every route - the
 * average absolute deviation per stop, which counts both late and early. Drops
 * stops below {@link MIN_STOP_EVENTS} so a thin sample can't top the board, and
 * collapses train platforms to one station (see {@link collapseWorstStops}). The
 * mode/school filters mirror the home page so the worst stop stays in step with
 * what's shown. Cached briefly.
 * @param range - The window to rank over.
 * @param filter - Mode/school filters mirroring the home page.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param limit - How many ranked stops to return.
 * @param revalidate - Cache lifetime in seconds.
 * @returns The worst stops, off-schedule magnitude descending.
 */
export async function getWorstStops(
  range: DateRange,
  filter: ShameFilter,
  limit: number,
  revalidate: number,
): Promise<WorstStop[]> {
  const { mode = null, includeSchool = false } = filter;
  return unstable_cache(
    async () => {
      const routeIds = await worstStopRouteIds(mode, includeSchool);
      const match: Record<string, unknown> = {
        scheduledAt: {
          $gte: { $date: range.start.toISOString() },
          $lt: { $date: range.end.toISOString() },
        },
        ...plausibleDeviationMatch,
      };
      if (routeIds) match.routeId = { $in: routeIds };

      // Fetch a generous candidate set so the post-aggregation platform collapse
      // can merge stations and still leave `limit` rows after re-ranking.
      const candidates = Math.max(80, limit * 8);
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            { $match: match },
            {
              $group: {
                _id: "$stopId",
                events: { $sum: 1 },
                avg_delay_sec: { $avg: "$deviationSec" },
                avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
                routeIds: { $addToSet: "$routeId" },
              },
            },
            { $match: { events: { $gte: MIN_STOP_EVENTS } } },
            { $lookup: { from: "Stop", localField: "_id", foreignField: "_id", as: "stop" } },
            { $unwind: "$stop" },
            { $sort: { avg_abs_delay_sec: -1 as const } },
            { $limit: candidates },
            {
              $project: {
                _id: 0,
                stop_id: { $toString: "$_id" },
                name: "$stop.name",
                events: 1,
                avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
                avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
                routeIds: 1,
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: Omit<WorstStopRaw, "mode">[] } };

      // Resolve dominant mode per stop from its route ids. When a mode filter is
      // active every stop already belongs to that mode; otherwise fetch the map.
      const modeMap = mode ? null : await getRouteModeMap();
      const enriched: WorstStopRaw[] = res.cursor.firstBatch.map((r) => ({
        ...r,
        mode: mode ?? dominantMode(r.routeIds, modeMap!),
      }));
      return collapseWorstStops(enriched).slice(0, limit);
    },
    [
      "worst-stops",
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      includeSchool ? "school" : "no-school",
      String(limit),
    ],
    { revalidate },
  )();
}

/**
 * The day's "Stop Shame": the single most off-schedule stop plus the worst stop
 * of each hour for a service window. Only stops with at least
 * {@link MIN_STOP_EVENTS_HOUR} events in that hour qualify. Cached briefly.
 * @param range - The service-day window.
 * @param filter - Mode/school filters.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The hour's worst stop and the per-hour worst list, earliest hour first.
 */
export async function getWorstStopsOfDay(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameStopOfDay> {
  const { mode = null, includeSchool = false } = filter;
  return unstable_cache(
    async () => {
      const routeIds = await worstStopRouteIds(mode, includeSchool);
      const match: Record<string, unknown> = {
        scheduledAt: {
          $gte: { $date: range.start.toISOString() },
          $lt: { $date: range.end.toISOString() },
        },
        ...plausibleDeviationMatch,
      };
      if (routeIds) match.routeId = { $in: routeIds };

      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            { $match: match },
            {
              $group: {
                _id: {
                  hour: { $hour: { date: "$scheduledAt", timezone: "Pacific/Auckland" } },
                  stop_id: "$stopId",
                },
                events: { $sum: 1 },
                avg_delay_sec: { $avg: "$deviationSec" },
                avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
                routeIds: { $addToSet: "$routeId" },
              },
            },
            { $match: { events: { $gte: MIN_STOP_EVENTS_HOUR } } },
            {
              $lookup: {
                from: "Stop",
                localField: "_id.stop_id",
                foreignField: "_id",
                as: "stop",
              },
            },
            { $unwind: "$stop" },
            { $sort: { avg_abs_delay_sec: -1 } },
            {
              $group: {
                _id: "$_id.hour",
                stop_id: { $first: { $toString: "$_id.stop_id" } },
                name: { $first: "$stop.name" },
                events: { $first: "$events" },
                avg_delay_sec: { $first: { $round: ["$avg_delay_sec", 1] } },
                avg_abs_delay_sec: { $first: { $round: ["$avg_abs_delay_sec", 1] } },
                routeIds: { $first: "$routeIds" },
              },
            },
            {
              $project: {
                _id: 0,
                hour: "$_id",
                stop_id: 1,
                name: 1,
                events: 1,
                avg_delay_sec: 1,
                avg_abs_delay_sec: 1,
                routeIds: 1,
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: (ShameStop & { routeIds: string[] })[] } };

      const modeMap = mode ? null : await getRouteModeMap();
      const hours: ShameStop[] = res.cursor.firstBatch.map((r) => ({
        hour: r.hour,
        stop_id: r.stop_id,
        name: r.name,
        events: r.events,
        avg_delay_sec: r.avg_delay_sec,
        avg_abs_delay_sec: r.avg_abs_delay_sec,
        mode: mode ?? dominantMode(r.routeIds, modeMap!),
      }));
      hours.sort(
        (a, b) =>
          ((a.hour + 24 - SERVICE_START_HOUR) % 24) - ((b.hour + 24 - SERVICE_START_HOUR) % 24),
      );
      const worst = hours.reduce<ShameStop | null>(
        (w, h) => (w == null || h.avg_abs_delay_sec > w.avg_abs_delay_sec ? h : w),
        null,
      );
      return { worst, hours };
    },
    [
      "worst-stops-of-day",
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      includeSchool ? "school" : "no-school",
    ],
    { revalidate },
  )();
}

/** Raw per-(serviceDay,stop) row from the Stop Shame week aggregation. */
interface ShameDayStopRaw {
  _id: unknown; // service-day UTC midnight Date
  stop_id: string;
  name: string;
  events: number;
  avg_delay_sec: number | null;
  avg_abs_delay_sec: number;
  routeIds: string[];
}

/**
 * The week's "Stop Shame": the single most off-schedule stop plus the worst stop
 * of each service day over a multi-day window. Only stops with at least
 * {@link MIN_STOP_EVENTS_HOUR} events on that day qualify. Cached at the supplied
 * revalidate rate.
 * @param range - The week (or multi-day) window.
 * @param filter - Mode/school filters.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The period's worst stop and the per-day worst list, earliest day first.
 */
export async function getWorstStopsOfWeek(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameStopOfWeek> {
  const { mode = null, includeSchool = false } = filter;
  return unstable_cache(
    async () => {
      const routeIds = await worstStopRouteIds(mode, includeSchool);
      const match: Record<string, unknown> = {
        scheduledAt: {
          $gte: { $date: range.start.toISOString() },
          $lt: { $date: range.end.toISOString() },
        },
        ...plausibleDeviationMatch,
      };
      if (routeIds) match.routeId = { $in: routeIds };

      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            { $match: match },
            {
              $group: {
                _id: {
                  serviceDay: {
                    $dateTrunc: {
                      date: {
                        $dateSubtract: {
                          startDate: "$scheduledAt",
                          unit: "hour",
                          amount: SERVICE_START_HOUR,
                        },
                      },
                      unit: "day",
                      timezone: "Pacific/Auckland",
                    },
                  },
                  stop_id: "$stopId",
                },
                events: { $sum: 1 },
                avg_delay_sec: { $avg: "$deviationSec" },
                avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
                routeIds: { $addToSet: "$routeId" },
              },
            },
            { $match: { events: { $gte: MIN_STOP_EVENTS_HOUR } } },
            {
              $lookup: {
                from: "Stop",
                localField: "_id.stop_id",
                foreignField: "_id",
                as: "stop",
              },
            },
            { $unwind: "$stop" },
            { $sort: { avg_abs_delay_sec: -1 } },
            {
              $group: {
                _id: "$_id.serviceDay",
                stop_id: { $first: { $toString: "$_id.stop_id" } },
                name: { $first: "$stop.name" },
                events: { $first: "$events" },
                avg_delay_sec: { $first: { $round: ["$avg_delay_sec", 1] } },
                avg_abs_delay_sec: { $first: { $round: ["$avg_abs_delay_sec", 1] } },
                routeIds: { $first: "$routeIds" },
              },
            },
            {
              $project: {
                _id: 1,
                stop_id: 1,
                name: 1,
                events: 1,
                avg_delay_sec: 1,
                avg_abs_delay_sec: 1,
                routeIds: 1,
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as {
        cursor: {
          firstBatch: (Omit<ShameDayStopRaw, "_id"> & { _id: unknown } & { routeIds: string[] })[];
        };
      };

      const modeMap = mode ? null : await getRouteModeMap();
      const days: ShameDayStop[] = res.cursor.firstBatch.map((r) => ({
        date: nzDateString(r._id),
        stop_id: r.stop_id,
        name: r.name,
        events: r.events,
        avg_delay_sec: r.avg_delay_sec,
        avg_abs_delay_sec: r.avg_abs_delay_sec,
        mode: mode ?? dominantMode(r.routeIds, modeMap!),
      }));
      days.sort((a, b) => a.date.localeCompare(b.date));
      const worst = days.reduce<ShameDayStop | null>(
        (w, d) => (w == null || d.avg_abs_delay_sec > w.avg_abs_delay_sec ? d : w),
        null,
      );
      return { worst, days };
    },
    [
      "worst-stops-of-week",
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      includeSchool ? "school" : "no-school",
    ],
    { revalidate },
  )();
}

/** A canonical stop resolved to its underlying platform ids + display position. */
interface StopGroup {
  /** Canonical id (a `station:` id for collapsed train platforms, else the stop id). */
  id: string;
  /** Underlying GTFS stop ids to match in the events (platforms of a station). */
  ids: string[];
  name: string;
  lat: number;
  lon: number;
}

/**
 * Resolve a (possibly station-collapsed) stop id to its underlying platform ids
 * and a display name/position, the way {@link routeIdsForSlug} resolves a route
 * slug. A `station:<name>` id expands to every train platform of that station; a
 * plain id resolves to itself. Returns null when no such stop exists.
 * @param id - The canonical stop id from a link (raw stop id or `station:` id).
 * @returns The resolved group, or null when unknown.
 */
async function resolveStopGroup(id: string): Promise<StopGroup | null> {
  return unstable_cache(
    async () => {
      if (id.startsWith("station:")) {
        // Platform ids aren't derivable from the station id, so scan the (small) set
        // of numbered train platforms and keep those that collapse to this station.
        const platforms = await prisma.stop.findMany({
          where: { name: { contains: "Train Station" } },
          select: { id: true, name: true, lat: true, lon: true },
        });
        const members = platforms.filter((s) => stationId(s.id, s.name) === id);
        if (members.length === 0) return null;
        const first = members[0];
        return {
          id,
          ids: members.map((s) => s.id),
          name: stationName(first.name),
          lat: first.lat,
          lon: first.lon,
        };
      }
      const stop = await prisma.stop.findUnique({
        where: { id },
        select: { id: true, name: true, lat: true, lon: true },
      });
      if (!stop) return null;
      return { id: stop.id, ids: [stop.id], name: stop.name, lat: stop.lat, lon: stop.lon };
    },
    ["resolve-stop-group", id],
    { revalidate: 86400 },
  )();
}

/** One facet's results from the stop-stats aggregation. */
interface StopStatsFacet {
  summary: RouteSummary[];
  routes: TopRouteRow[];
  routeCount: { n: number }[];
}

/**
 * How a single stop performed across every route in a window: an overall
 * punctuality summary and the worst routes calling at it. Mirrors the per-route
 * pipeline but matches by stop (all platform ids of a station) with no route
 * filter, joining Route so the on-time split honours each event's mode-specific
 * window (see {@link onTimePerEventSum}). Cached briefly.
 * @param id - Canonical stop id (raw stop id or `station:` id).
 * @param range - The window to summarise.
 * @param thresholdSec - On-time late bound, for cache-key versioning only.
 * @param revalidate - Cache lifetime in seconds.
 * @returns The stop's stats, or null when the stop id is unknown.
 */
export async function getStopStats(
  id: string,
  range: DateRange,
  thresholdSec: number,
  revalidate: number,
): Promise<StopStats | null> {
  return unstable_cache(
    async () => {
      const group = await resolveStopGroup(id);
      if (!group) return null;

      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            {
              $match: {
                stopId: { $in: group.ids },
                scheduledAt: {
                  $gte: { $date: range.start.toISOString() },
                  $lt: { $date: range.end.toISOString() },
                },
                ...plausibleDeviationMatch,
              },
            },
            { $lookup: { from: "Route", localField: "routeId", foreignField: "_id", as: "route" } },
            { $unwind: "$route" },
            {
              $facet: {
                summary: [
                  {
                    $group: {
                      _id: null,
                      events: { $sum: 1 },
                      avg_delay_sec: { $avg: "$deviationSec" },
                      avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
                      on_time_count: onTimePerEventSum(),
                      late_count: lateSum(),
                    },
                  },
                  // Every event is exactly one of early/on-time/late, so early is
                  // the remainder - no separate mode-aware early accumulator needed.
                  {
                    $addFields: {
                      early_count: {
                        $subtract: ["$events", { $add: ["$on_time_count", "$late_count"] }],
                      },
                    },
                  },
                  {
                    $addFields: {
                      on_time_pct: { $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] },
                      early_pct: { $multiply: [{ $divide: ["$early_count", "$events"] }, 100] },
                      late_pct: { $multiply: [{ $divide: ["$late_count", "$events"] }, 100] },
                    },
                  },
                  {
                    $project: {
                      _id: 0,
                      events: 1,
                      avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
                      avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
                      on_time_pct: { $round: ["$on_time_pct", 1] },
                      early_pct: { $round: ["$early_pct", 1] },
                      late_pct: { $round: ["$late_pct", 1] },
                    },
                  },
                ],
                routes: [
                  {
                    $group: {
                      _id: "$routeId",
                      events: { $sum: 1 },
                      avg_delay_sec: { $avg: "$deviationSec" },
                      avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
                      on_time_count: onTimePerEventSum(),
                      short_name: { $first: "$route.shortName" },
                      long_name: { $first: "$route.longName" },
                      mode: { $first: "$route.mode" },
                    },
                  },
                  {
                    $addFields: {
                      on_time_pct: { $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] },
                    },
                  },
                  { $sort: { avg_abs_delay_sec: -1 as const } },
                  { $limit: 12 },
                  {
                    $project: {
                      _id: 0,
                      route_id: { $toString: "$_id" },
                      short_name: 1,
                      long_name: 1,
                      mode: 1,
                      events: 1,
                      avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
                      avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
                      on_time_pct: { $round: ["$on_time_pct", 1] },
                    },
                  },
                ],
                routeCount: [{ $group: { _id: "$routeId" } }, { $count: "n" }],
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: StopStatsFacet[] } };

      const facet = res.cursor.firstBatch[0];
      return {
        stop: { stop_id: group.id, name: group.name, lat: group.lat, lon: group.lon },
        summary: facet?.summary[0] ?? null,
        routes: facet?.routes ?? [],
        routes_count: facet?.routeCount[0]?.n ?? 0,
      };
    },
    ["stop-stats", id, range.start.toISOString(), range.end.toISOString(), String(thresholdSec)],
    { revalidate },
  )();
}

/** Raw trip-timeline stop row before the `scheduled_at` date is normalised. */
interface TripStopRaw extends Omit<TripStop, "scheduled_at"> {
  scheduled_at: { $date: string } | string;
  vehicle_id: string | null;
}

/**
 * The Auckland-local service-day window of a trip's most recent run, so an
 * undated timeline request still resolves to a single run (a run that crosses
 * midnight stays in one service day).
 * @param tripId - The trip to scope.
 * @returns The latest run's service-day window, or null when the trip has no events.
 */
async function latestTripDay(tripId: string): Promise<DateRange | null> {
  // Cache the raw ISO string; reconstruct DateRange outside to avoid Date serialisation issues.
  const iso = await unstable_cache(
    async () => {
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            { $match: { tripId } },
            { $group: { _id: null, max: { $max: "$scheduledAt" } } },
          ] as never,
          cursor: { batchSize: 1 },
        }),
      )) as unknown as { cursor: { firstBatch: { max?: { $date: string } | string }[] } };
      const raw = res.cursor.firstBatch[0]?.max;
      return raw ? toIso(raw) : null;
    },
    ["latest-trip-day", tripId],
    { revalidate: 21600 },
  )();
  return iso ? nzServiceDayRange(new Date(iso)) : null;
}

/**
 * A single trip run's stop-by-stop scheduled-vs-actual timeline, in stop order.
 * A GTFS `tripId` repeats every service day, so the events are scoped to one
 * day - the supplied `range` (the run the user clicked) or the trip's latest day
 * - otherwise different days' runs interleave and stops appear out of order or
 * duplicated. Consecutive events for the same stop (a stop with two recorded
 * actuals) are collapsed. Cached briefly.
 * @param tripId - The trip (run) to resolve.
 * @param routeId - The owning route (for the header).
 * @param range - The run's Auckland-local day window; defaults to its latest day.
 * @returns The route header, vehicle, and ordered stops.
 */
export async function getTripTimeline(
  tripId: string,
  routeId: string,
  range?: DateRange,
): Promise<TripTimeline> {
  const day = range ?? (await latestTripDay(tripId));
  return unstable_cache(
    async () => {
      const routeIds = await routeIdsForSlug(routeId);
      const route = await prisma.route.findUnique({
        where: { id: routeIds[0] },
        select: { shortName: true, longName: true, mode: true, colour: true },
      });

      const match: Record<string, unknown> = { tripId, ...plausibleDeviationMatch };
      if (day) {
        match.scheduledAt = {
          $gte: { $date: day.start.toISOString() },
          $lt: { $date: day.end.toISOString() },
        };
      }

      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            { $match: match },
            { $sort: { scheduledAt: 1 as const } },
            { $lookup: { from: "Stop", localField: "stopId", foreignField: "_id", as: "stop" } },
            { $unwind: "$stop" },
            {
              $project: {
                _id: 0,
                stop_id: { $toString: "$stopId" },
                name: "$stop.name",
                lat: "$stop.lat",
                lon: "$stop.lon",
                scheduled_at: "$scheduledAt",
                deviation_sec: "$deviationSec",
                vehicle_id: "$vehicleId",
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: TripStopRaw[] } };

      // AT re-reports a trip_id against a later vehicle cycle, so a stop can carry
      // both its real arrival and a "ghost" reading ~1h off - and the ghosts can
      // even outnumber the real events. Collapse each station (and its platforms)
      // to the event nearest its own schedule (the real run); the run's deviation
      // level is then the median of those, and any station left only with a ghost
      // (a gross outlier from that level) is dropped rather than shown wildly late.
      const GHOST_GAP_SEC = 45 * 60;
      const bestByStop = new Map<string, TripStopRaw>();
      for (const r of res.cursor.firstBatch) {
        const id = stationId(r.stop_id, r.name);
        const cur = bestByStop.get(id);
        if (!cur || Math.abs(r.deviation_sec) < Math.abs(cur.deviation_sec)) bestByStop.set(id, r);
      }
      const chosen = [...bestByStop.values()].sort(
        (a, b) => +new Date(toIso(a.scheduled_at)) - +new Date(toIso(b.scheduled_at)),
      );
      const devs = chosen.map((r) => r.deviation_sec).sort((a, b) => a - b);
      const runMedian = devs.length ? devs[Math.floor(devs.length / 2)] : 0;

      const stops: TripStop[] = [];
      for (const r of chosen) {
        if (Math.abs(r.deviation_sec - runMedian) > GHOST_GAP_SEC) continue;
        stops.push({
          stop_id: stationId(r.stop_id, r.name),
          name: stationName(r.name),
          lat: r.lat,
          lon: r.lon,
          scheduled_at: toIso(r.scheduled_at),
          deviation_sec: r.deviation_sec,
        });
      }
      return {
        trip_id: tripId,
        route: route
          ? {
              shortName: route.shortName,
              longName: route.longName,
              mode: route.mode,
              colour: route.colour,
            }
          : null,
        vehicle_id: res.cursor.firstBatch.find((r) => r.vehicle_id)?.vehicle_id ?? null,
        stops,
      };
    },
    ["trip-timeline", tripId, routeId, day?.start.toISOString() ?? "all"],
    { revalidate: 300 },
  )();
}

/** One stop in a trip's GTFS scheduled stop sequence. */
export interface ScheduledStop {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  stop_sequence: number;
  /** GTFS departure time "HH:MM:SS"; hours may exceed 23 for post-midnight trips. */
  departure_time: string | null;
}

/**
 * Scheduled stop sequence for a trip from the AT GTFS static feed, joined with
 * stop names and coordinates from the database. Cached for a day - the schedule
 * does not change during a trip's service day.
 * @param tripId - AT GTFS trip id.
 * @returns Stops ordered by stop_sequence with display names and coordinates.
 */
export async function getTripScheduledStops(tripId: string): Promise<ScheduledStop[]> {
  interface RawStopTime {
    stop_id: string;
    stop_sequence: number;
    departure_time?: string | null;
  }
  return unstable_cache(
    async () => {
      const stoptimes = await fetchAll<RawStopTime>(
        `/trips/${encodeURIComponent(tripId)}/stoptimes`,
      ).catch(() => [] as RawStopTime[]);
      if (stoptimes.length === 0) return [];
      const ordered = stoptimes.slice().sort((a, b) => a.stop_sequence - b.stop_sequence);
      const stopIds = ordered.map((s) => s.stop_id);
      const stopDocs = await prisma.stop.findMany({
        where: { id: { in: stopIds } },
        select: { id: true, name: true, lat: true, lon: true },
      });
      const stopById = new Map(stopDocs.map((s) => [s.id, s]));
      const out: ScheduledStop[] = [];
      for (const st of ordered) {
        const stop = stopById.get(st.stop_id);
        if (!stop) continue;
        out.push({
          stop_id: stationId(stop.id, stop.name),
          name: stationName(stop.name),
          lat: stop.lat,
          lon: stop.lon,
          stop_sequence: st.stop_sequence,
          departure_time: st.departure_time ?? null,
        });
      }
      return out;
    },
    ["trip-scheduled-stops", tripId],
    { revalidate: 86_400 },
  )();
}

/**
 * Look up short names for a set of route ids. Returns a map of id to shortName,
 * falling back to the raw id when the route has no shortName set.
 * @param routeIds - Route ids to look up.
 * @returns Record mapping each id to its display name.
 */
export async function getRouteNames(routeIds: string[]): Promise<Record<string, string>> {
  if (routeIds.length === 0) return {};
  return unstable_cache(
    async () => {
      const rows = await prisma.route.findMany({
        where: { id: { in: routeIds } },
        select: { id: true, shortName: true },
      });
      return Object.fromEntries(rows.map((r) => [r.id, r.shortName ?? r.id]));
    },
    ["route-names", ...[...routeIds].sort()],
    { revalidate: 86400 },
  )();
}

/**
 * Fetch aggregated stats for a route from `DailyRouteSummary`, newest first.
 * Supply `from`/`to` (UTC instants) to fetch a specific window; omit both to
 * get the rolling last 7 records. Returns an empty array when no summary
 * records exist (route never ingested or backfill not yet run).
 * @param routeId - AT route id (slug form).
 * @param from - Inclusive window start (UTC). Omit for rolling-7 behaviour.
 * @param to - Exclusive window end (UTC). Omit for rolling-7 behaviour.
 * @returns Per-day stats, newest first.
 */
export async function getRouteDailyStats(
  routeId: string,
  from?: Date,
  to?: Date,
): Promise<RouteDay[]> {
  return unstable_cache(
    async () => {
      // DailyRouteSummary stores versioned route IDs (e.g. "209-217"), not slugs.
      const routeIds = await routeIdsForSlug(routeId);
      const rows = await prisma.dailyRouteSummary.findMany({
        where: {
          routeId: { in: routeIds },
          ...(from || to
            ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
            : {}),
        },
        orderBy: { date: "desc" },
        ...(from || to ? {} : { take: 7 }),
        select: {
          date: true,
          events: true,
          avgDelaySec: true,
          avgAbsDelaySec: true,
          onTimePct: true,
        },
      });
      return rows.map((r) => ({
        date: nzServiceDayString(r.date),
        events: r.events,
        avg_delay_sec: r.avgDelaySec ?? null,
        avg_abs_delay_sec: r.avgAbsDelaySec ?? null,
        on_time_pct: r.onTimePct ?? null,
      }));
    },
    ["route-daily-stats", routeId, from?.toISOString() ?? "", to?.toISOString() ?? ""],
    { revalidate: 300 },
  )();
}
