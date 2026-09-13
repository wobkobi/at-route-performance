// src/lib/data/route-stats.ts
// One route's stats: the day summary with per-stop rows, and the per-day week table.
import { MS_IN_DAY, cachedForRange, scheduledAtWindow } from "@/lib/data/cache";
import { routeIdsForSlug } from "@/lib/data/routes";
import { prisma, runCommand } from "@/lib/db";
import { realDeviationMatchFor } from "@/lib/deviation";
import { unstable_cache } from "@/lib/mem-cache";
import { earlySingleModeSum, lateSum, onTimeSingleModeSum } from "@/lib/on-time";
import { serviceDateExpr } from "@/lib/service-day-expr";
import { stationId, stationName, stationPartsOf, stationProjection } from "@/lib/station";
import {
  type DateRange,
  nzLast7DaysRange,
  nzServiceDayRange,
  nzServiceDayString,
  serviceDatesInRange,
} from "@/lib/time";
import type { RouteByStop, RouteDay, RouteSummary } from "@/types/api";

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
    const id = stationId(r.stop_id, r.name, stationPartsOf(r));
    const delaySum = (r.avg_delay_sec ?? 0) * r.events;
    const otCount = ((r.on_time_pct ?? 0) / 100) * r.events;
    const cur = acc.get(id);
    if (cur) {
      cur.row.events += r.events;
      cur.delaySum += delaySum;
      cur.otCount += otCount;
    } else {
      // The merged row is the station, so it carries no single platform's grouping.
      acc.set(id, {
        row: {
          ...r,
          stop_id: id,
          name: stationName(r.name),
          parent_station: undefined,
          platform_code: undefined,
        },
        delaySum,
        otCount,
      });
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
 * @param classified - Whether every day in the window has been through the ghost pass.
 * @returns Summary and top stops.
 */
async function queryRouteStats(p: RouteStatsParams, classified: boolean): Promise<RouteStats> {
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
    scheduledAt: scheduledAtWindow({ start, end }),
    ...realDeviationMatchFor(classified),
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
            ...stationProjection,
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
  return cachedForRange(
    (classified) => queryRouteStats(p, classified),
    [
      "route-stats",
      p.routeId,
      p.from?.toISOString() ?? "",
      p.to?.toISOString() ?? "",
      String(p.thresholdSec),
    ],
    // The rolling default (no from/to) tracks the live day.
    p.from && p.to ? { start: p.from, end: p.to } : null,
    300,
  );
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

/**
 * Event-weighted mean of one per-day field across the rows for a date. Rows
 * without a value contribute nothing; null when none has one.
 * @param group - The rows sharing a date.
 * @param pick - Reads the field from a row.
 * @returns The weighted mean rounded to one decimal, or null.
 */
function weightedDayField(
  group: readonly RouteDay[],
  pick: (row: RouteDay) => number | null,
): number | null {
  const valued = group.filter((r) => pick(r) !== null && r.events > 0);
  const weight = valued.reduce((n, r) => n + r.events, 0);
  if (weight === 0) return null;
  const sum = valued.reduce((n, r) => n + (pick(r) ?? 0) * r.events, 0);
  return Math.round((sum / weight) * 10) / 10;
}

/**
 * Merge per-day rows that share a service date (two feed versions of a route,
 * or a line and its predecessor, each summarised for the same day) into one
 * event-weighted row.
 * @param rows - Per-day rows, any order.
 * @returns One row per date, newest first.
 */
function mergeRouteDays(rows: readonly RouteDay[]): RouteDay[] {
  const byDate = new Map<string, RouteDay[]>();
  for (const row of rows) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
  return [...byDate.entries()]
    .map(([date, group]) => ({
      date,
      events: group.reduce((n, r) => n + r.events, 0),
      avg_delay_sec: weightedDayField(group, (r) => r.avg_delay_sec),
      avg_abs_delay_sec: weightedDayField(group, (r) => r.avg_abs_delay_sec),
      on_time_pct: weightedDayField(group, (r) => r.on_time_pct),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * Per-day stats for a route over a window, newest first: `DailyRouteSummary`
 * rows for the days the nightly aggregate has covered, plus one live
 * `ArrivalEvent` aggregation grouped by service date for the days it has not
 * (today, and any earlier day whose aggregate has not run). The live rows use
 * the same real-reading filter and per-mode on-time window as the route's day
 * view, so a day reads the same in both places. Supply `from`/`to` for a
 * specific window; omit both for the last seven service days. Days with no
 * arrivals are omitted.
 * @param routeId - AT route id (slug form).
 * @param from - Inclusive window start (UTC). Omit for the rolling week.
 * @param to - Exclusive window end (UTC). Omit for the rolling week.
 * @returns Per-day stats, newest first.
 */
export async function getRouteDailyStats(
  routeId: string,
  from?: Date,
  to?: Date,
): Promise<RouteDay[]> {
  const range: DateRange = from && to ? { start: from, end: to } : nzLast7DaysRange();
  return cachedForRange(
    async () => {
      // DailyRouteSummary stores versioned route IDs (e.g. "209-217"), not slugs.
      const routeIds = await routeIdsForSlug(routeId);
      const today = nzServiceDayString();
      const summaries = await prisma.dailyRouteSummary.findMany({
        where: { routeId: { in: routeIds }, date: { gte: range.start, lt: range.end } },
        select: {
          date: true,
          events: true,
          avgDelaySec: true,
          avgAbsDelaySec: true,
          onTimePct: true,
        },
      });
      const days: RouteDay[] = summaries
        .map((r) => ({
          date: nzServiceDayString(r.date),
          events: r.events,
          avg_delay_sec: r.avgDelaySec ?? null,
          avg_abs_delay_sec: r.avgAbsDelaySec ?? null,
          on_time_pct: r.onTimePct ?? null,
        }))
        // A summary for the live day would be a mid-day snapshot; read it live.
        .filter((r) => r.date < today);

      const summarised = new Set(days.map((r) => r.date));
      const now = new Date();
      const liveDates = serviceDatesInRange(range).filter(
        (date) => !summarised.has(date) && nzServiceDayRange(date).start <= now,
      );
      const [firstLive] = liveDates;
      const lastLive = liveDates.at(-1);
      if (firstLive !== undefined && lastLive !== undefined) {
        const live: DateRange = {
          start: nzServiceDayRange(firstLive).start,
          end: nzServiceDayRange(lastLive).end,
        };
        const route = await prisma.route.findUnique({
          where: { id: routeIds[0] ?? routeId },
          select: { mode: true },
        });
        const mode = route?.mode ?? "BUS";
        const res = (await runCommand(() =>
          prisma.$runCommandRaw({
            aggregate: "ArrivalEvent",
            pipeline: [
              {
                $match: {
                  routeId: { $in: routeIds },
                  scheduledAt: scheduledAtWindow(live),
                  // Only unsummarised days are scanned here, so the guard stays on.
                  ...realDeviationMatchFor(false),
                },
              },
              {
                $group: {
                  _id: serviceDateExpr("$scheduledAt"),
                  events: { $sum: 1 },
                  avg_delay_sec: { $avg: "$deviationSec" },
                  avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
                  on_time_count: onTimeSingleModeSum(mode),
                },
              },
              {
                $project: {
                  _id: 1,
                  events: 1,
                  avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
                  avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
                  on_time_pct: {
                    $round: [{ $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] }, 1],
                  },
                },
              },
            ] as never,
            cursor: { batchSize: 100_000 },
          }),
        )) as unknown as {
          cursor: { firstBatch: (Omit<RouteDay, "date"> & { _id: string })[] };
        };
        // The live window may span a summarised day in between; keep only the
        // dates that have no summary.
        const wanted = new Set(liveDates);
        for (const row of res.cursor.firstBatch) {
          if (wanted.has(row._id)) days.push({ ...row, date: row._id });
        }
      }
      return mergeRouteDays(days);
    },
    ["route-daily-stats", routeId, from?.toISOString() ?? "", to?.toISOString() ?? ""],
    range,
    300,
  );
}
