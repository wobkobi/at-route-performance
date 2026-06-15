// src/lib/data.ts
import { prisma } from "@/lib/db";
import type { DateRange } from "@/lib/time";
import type { RouteByStop, RouteSummary, TopRouteRow } from "@/types/api";
import type { FleetSummary, ModeStat } from "@/types/dashboard";
import { unstable_cache } from "next/cache";

const MS_IN_WEEK = 604_800_000;
const MS_IN_DAY = 86_400_000;

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
  route: { shortName: string | null; longName: string; mode: string } | null;
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
 * ISO week label (e.g. `2026-W08`) for a date, matching {@link isoWeekRange}'s
 * week numbering so the value round-trips back to the same range.
 * @param d - The date to label.
 * @returns ISO week string using the ISO week-numbering year.
 */
function isoWeekString(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  // Shift to this week's Thursday; its calendar year is the ISO week-year.
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / MS_IN_DAY + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * ISO week of the most recent ArrivalEvent. The home page uses this to fall back
 * from an empty current week to the latest week that actually has data.
 * @returns ISO week string like `2026-W08`, or null when there are no events.
 */
export async function getLatestDataWeek(): Promise<string | null> {
  const res = (await prisma.$runCommandRaw({
    aggregate: "ArrivalEvent",
    pipeline: [{ $group: { _id: null, maxSched: { $max: "$scheduledAt" } } }],
    cursor: {},
  })) as unknown as {
    cursor: { firstBatch: { maxSched?: { $date: string } | string }[] };
  };
  const raw = res.cursor.firstBatch[0]?.maxSched;
  if (!raw) return null;
  // $runCommandRaw serialises dates as extended JSON ({ $date: "..." }).
  return isoWeekString(new Date(typeof raw === "string" ? raw : raw.$date));
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
      },
    },
    {
      $group: {
        _id: "$routeId",
        events: { $sum: 1 },
        avg_delay_sec: { $avg: "$deviationSec" },
        avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
        on_time_count: {
          $sum: {
            $cond: [{ $lte: [{ $abs: "$deviationSec" }, p.thresholdSec] }, 1, 0],
          },
        },
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
        from: "Route",
        localField: "_id",
        foreignField: "_id",
        as: "route",
      },
    },
    { $unwind: "$route" },
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

  const result = (await prisma.$runCommandRaw({
    aggregate: "ArrivalEvent",
    pipeline: pipeline as never,
    cursor: {},
  })) as unknown as { cursor: { firstBatch: TopRouteRow[] } };

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
 * Run the route-stats aggregations (summary + per-stop) against MongoDB.
 * @param p - Validated parameters; window defaults to the last 7 days.
 * @returns Summary and top stops.
 */
async function queryRouteStats(p: RouteStatsParams): Promise<RouteStats> {
  const start = p.from ?? new Date(Date.now() - 7 * MS_IN_DAY);
  const end = p.to ?? new Date();

  const route = await prisma.route.findUnique({
    where: { id: p.routeId },
    select: { shortName: true, longName: true, mode: true },
  });

  const match = {
    routeId: p.routeId,
    scheduledAt: {
      $gte: { $date: start.toISOString() },
      $lt: { $date: end.toISOString() },
    },
  };

  const summaryResult = (await prisma.$runCommandRaw({
    aggregate: "ArrivalEvent",
    pipeline: [
      { $match: match },
      {
        $group: {
          _id: null,
          events: { $sum: 1 },
          avg_delay_sec: { $avg: "$deviationSec" },
          on_time_count: {
            $sum: {
              $cond: [{ $lte: [{ $abs: "$deviationSec" }, p.thresholdSec] }, 1, 0],
            },
          },
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
        $project: {
          _id: 0,
          events: 1,
          avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
          on_time_pct: { $round: ["$on_time_pct", 1] },
        },
      },
    ],
    cursor: {},
  })) as unknown as { cursor: { firstBatch: RouteSummary[] } };

  const byStopResult = (await prisma.$runCommandRaw({
    aggregate: "ArrivalEvent",
    pipeline: [
      { $match: match },
      {
        $group: {
          _id: "$stopId",
          events: { $sum: 1 },
          avg_delay_sec: { $avg: "$deviationSec" },
          on_time_count: {
            $sum: {
              $cond: [{ $lte: [{ $abs: "$deviationSec" }, p.thresholdSec] }, 1, 0],
            },
          },
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
    cursor: {},
  })) as unknown as { cursor: { firstBatch: RouteByStop[] } };

  return {
    route: route
      ? { shortName: route.shortName, longName: route.longName, mode: route.mode }
      : null,
    summary: summaryResult.cursor.firstBatch[0] ?? null,
    byStop: byStopResult.cursor.firstBatch,
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
 * Per-route aggregated rows for an arbitrary window (no ranking applied here).
 * @param range - UTC half-open window.
 * @param thresholdSec - On-time threshold in seconds.
 * @returns Rows for every route with at least one event in the window.
 */
async function queryRankings(range: DateRange, thresholdSec: number): Promise<TopRouteRow[]> {
  const result = (await prisma.$runCommandRaw({
    aggregate: "ArrivalEvent",
    pipeline: [
      {
        $match: {
          scheduledAt: {
            $gte: { $date: range.start.toISOString() },
            $lt: { $date: range.end.toISOString() },
          },
        },
      },
      {
        $group: {
          _id: "$routeId",
          events: { $sum: 1 },
          avg_delay_sec: { $avg: "$deviationSec" },
          avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
          on_time_count: {
            $sum: { $cond: [{ $lte: [{ $abs: "$deviationSec" }, thresholdSec] }, 1, 0] },
          },
        },
      },
      {
        $addFields: {
          on_time_pct: { $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] },
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
          avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
          avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
          on_time_pct: { $round: ["$on_time_pct", 1] },
        },
      },
    ] as never,
    cursor: {},
  })) as unknown as { cursor: { firstBatch: TopRouteRow[] } };
  return result.cursor.firstBatch;
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
    () => queryRankings(range, thresholdSec),
    ["rankings", range.start.toISOString(), range.end.toISOString(), String(thresholdSec)],
    { revalidate },
  )();
}

/**
 * Fleet-wide totals for a window. On-time % is weighted from raw events.
 * @param range - UTC half-open window.
 * @param thresholdSec - On-time threshold in seconds.
 * @param revalidate - Cache TTL in seconds.
 * @returns Fleet summary, or zeros when the window is empty.
 */
export async function getFleetSummary(
  range: DateRange,
  thresholdSec: number,
  revalidate: number,
): Promise<FleetSummary> {
  return unstable_cache(
    async () => {
      const res = (await prisma.$runCommandRaw({
        aggregate: "ArrivalEvent",
        pipeline: [
          {
            $match: {
              scheduledAt: {
                $gte: { $date: range.start.toISOString() },
                $lt: { $date: range.end.toISOString() },
              },
            },
          },
          {
            $group: {
              _id: null,
              events: { $sum: 1 },
              avg_delay_sec: { $avg: "$deviationSec" },
              on_time_count: {
                $sum: { $cond: [{ $lte: [{ $abs: "$deviationSec" }, thresholdSec] }, 1, 0] },
              },
              routes: { $addToSet: "$routeId" },
            },
          },
          {
            $project: {
              _id: 0,
              events: 1,
              avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
              on_time_pct: {
                $round: [{ $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] }, 1],
              },
              route_count: { $size: "$routes" },
            },
          },
        ] as never,
        cursor: {},
      })) as unknown as { cursor: { firstBatch: FleetSummary[] } };
      return (
        res.cursor.firstBatch[0] ?? {
          events: 0,
          on_time_pct: null,
          avg_delay_sec: null,
          route_count: 0,
        }
      );
    },
    ["fleet-summary", range.start.toISOString(), range.end.toISOString(), String(thresholdSec)],
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
      const res = (await prisma.$runCommandRaw({
        aggregate: "ArrivalEvent",
        pipeline: [
          {
            $match: {
              scheduledAt: {
                $gte: { $date: range.start.toISOString() },
                $lt: { $date: range.end.toISOString() },
              },
            },
          },
          { $lookup: { from: "Route", localField: "routeId", foreignField: "_id", as: "route" } },
          { $unwind: "$route" },
          {
            $group: {
              _id: "$route.mode",
              events: { $sum: 1 },
              avg_delay_sec: { $avg: "$deviationSec" },
              on_time_count: {
                $sum: { $cond: [{ $lte: [{ $abs: "$deviationSec" }, thresholdSec] }, 1, 0] },
              },
            },
          },
          {
            $project: {
              _id: 0,
              mode: "$_id",
              events: 1,
              avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
              on_time_pct: {
                $round: [{ $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] }, 1],
              },
            },
          },
        ] as never,
        cursor: {},
      })) as unknown as { cursor: { firstBatch: ModeStat[] } };
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
  const res = (await prisma.$runCommandRaw({
    aggregate: "ArrivalEvent",
    pipeline: [{ $group: { _id: null, maxSched: { $max: "$scheduledAt" } } }] as never,
    cursor: {},
  })) as unknown as { cursor: { firstBatch: { maxSched?: { $date: string } | string }[] } };
  const raw = res.cursor.firstBatch[0]?.maxSched;
  if (!raw) return null;
  return new Date(typeof raw === "string" ? raw : raw.$date);
}
