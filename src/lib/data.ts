// src/lib/data.ts
import { prisma } from "@/lib/db";
import { nzServiceDayRange, SERVICE_START_HOUR, type DateRange } from "@/lib/time";
import type {
  PerTripStat,
  RouteByStop,
  RouteSummary,
  TopRouteRow,
  TripStop,
  TripTimeline,
} from "@/types/api";
import type { FleetSummary, ModeStat } from "@/types/dashboard";
import { unstable_cache } from "next/cache";

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
    cursor: { batchSize: 100_000 },
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
    cursor: { batchSize: 100_000 },
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
    cursor: { batchSize: 100_000 },
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
    cursor: { batchSize: 100_000 },
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
        cursor: { batchSize: 100_000 },
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
        cursor: { batchSize: 100_000 },
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
    cursor: { batchSize: 100_000 },
  })) as unknown as { cursor: { firstBatch: { maxSched?: { $date: string } | string }[] } };
  const raw = res.cursor.firstBatch[0]?.maxSched;
  if (!raw) return null;
  return new Date(typeof raw === "string" ? raw : raw.$date);
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
  const res = (await prisma.$runCommandRaw({
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
  })) as unknown as { cursor: { firstBatch: { _id?: { $date: string } | string }[] } };
  const raw = res.cursor.firstBatch[0]?._id;
  if (!raw) return null;
  // The bucket is the service day's local midnight; return its local noon so the
  // hour sits safely inside the service day for nzServiceDayRange.
  const bucket = new Date(typeof raw === "string" ? raw : raw.$date);
  return new Date(bucket.getTime() + 12 * 60 * 60 * 1000);
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
      const res = (await prisma.$runCommandRaw({
        aggregate: "ArrivalEvent",
        pipeline: [
          { $match: { routeId, scheduledAt: { $gte: { $date: since.toISOString() } } } },
          { $group: { _id: "$stopId" } },
        ] as never,
        cursor: { batchSize: 100_000 },
      })) as unknown as { cursor: { firstBatch: { _id: string }[] } };
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
}

/** Raw worst-trips row before the `scheduled_start` date is normalised. */
interface WorstTripRaw extends Omit<PerTripStat, "scheduled_start"> {
  scheduled_start: { $date: string } | string;
}

/**
 * Rank each run (trip) of a route on a day by how far off schedule it was.
 * Sorted worst-first by average absolute deviation; the signed average is kept
 * so the board can still show late/early direction. Cached briefly.
 * @param p - Route, day window, on-time threshold, and optional row limit.
 * @returns Per-trip rows, worst-first (up to `limit`, default 50).
 */
export async function getWorstTripsOfDay(p: WorstTripsParams): Promise<PerTripStat[]> {
  const limit = p.limit ?? 50;
  return unstable_cache(
    async () => {
      const res = (await prisma.$runCommandRaw({
        aggregate: "ArrivalEvent",
        pipeline: [
          {
            $match: {
              routeId: p.routeId,
              scheduledAt: {
                $gte: { $date: p.range.start.toISOString() },
                $lt: { $date: p.range.end.toISOString() },
              },
            },
          },
          {
            $group: {
              _id: "$tripId",
              vehicle_id: { $first: "$vehicleId" },
              scheduled_start: { $min: "$scheduledAt" },
              stops: { $sum: 1 },
              avg_delay_sec: { $avg: "$deviationSec" },
              avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
              worst_delay_sec: { $max: "$deviationSec" },
            },
          },
          { $sort: { avg_abs_delay_sec: -1 as const } },
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
            },
          },
        ] as never,
        cursor: { batchSize: 100_000 },
      })) as unknown as { cursor: { firstBatch: WorstTripRaw[] } };
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
    ],
    { revalidate: 300 },
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
  const res = (await prisma.$runCommandRaw({
    aggregate: "ArrivalEvent",
    pipeline: [
      { $match: { tripId } },
      { $group: { _id: null, max: { $max: "$scheduledAt" } } },
    ] as never,
    cursor: { batchSize: 1 },
  })) as unknown as { cursor: { firstBatch: { max?: { $date: string } | string }[] } };
  const raw = res.cursor.firstBatch[0]?.max;
  return raw ? nzServiceDayRange(new Date(toIso(raw))) : null;
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
      const route = await prisma.route.findUnique({
        where: { id: routeId },
        select: { shortName: true, longName: true, mode: true },
      });

      const match: Record<string, unknown> = { tripId };
      if (day) {
        match.scheduledAt = {
          $gte: { $date: day.start.toISOString() },
          $lt: { $date: day.end.toISOString() },
        };
      }

      const res = (await prisma.$runCommandRaw({
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
              scheduled_at: "$scheduledAt",
              deviation_sec: "$deviationSec",
              vehicle_id: "$vehicleId",
            },
          },
        ] as never,
        cursor: { batchSize: 100_000 },
      })) as unknown as { cursor: { firstBatch: TripStopRaw[] } };

      const stops: TripStop[] = [];
      for (const r of res.cursor.firstBatch) {
        // Collapse a stop that recorded two actuals into one timeline row.
        if (stops[stops.length - 1]?.stop_id === r.stop_id) continue;
        stops.push({
          stop_id: r.stop_id,
          name: r.name,
          scheduled_at: toIso(r.scheduled_at),
          deviation_sec: r.deviation_sec,
        });
      }
      return {
        trip_id: tripId,
        route: route
          ? { shortName: route.shortName, longName: route.longName, mode: route.mode }
          : null,
        vehicle_id: res.cursor.firstBatch.find((r) => r.vehicle_id)?.vehicle_id ?? null,
        stops,
      };
    },
    ["trip-timeline", tripId, routeId, day?.start.toISOString() ?? "all"],
    { revalidate: 300 },
  )();
}
