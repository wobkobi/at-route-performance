// src/lib/data/stops.ts
// Stops and stations: worst-stop boards, station grouping and one stop's stats.
import { cachedForDay, cachedForRange, scheduledAtWindow } from "@/lib/data/cache";
import { getRouteModeMap, routeIdsForSlug } from "@/lib/data/routes";
import { type ShameFilter, worstStopRouteIds } from "@/lib/data/shame-filter";
import { cachedWorstTripsOfDay } from "@/lib/data/shame-trips";
import { prisma, runCommand } from "@/lib/db";
import { realDeviationMatchFor } from "@/lib/deviation";
import { unstable_cache } from "@/lib/mem-cache";
import { lateSum, onTimePerEventSum } from "@/lib/on-time";
import {
  STATION_PREFIX,
  type StationRow,
  isLegacyStationId,
  isPlatformStop,
  legacyStationId,
  stationId,
  stationName,
  stationPartsOf,
  stationProjection,
} from "@/lib/station";
import { type StopDaySum, mergeStopDays, rankStopSums } from "@/lib/stop-sums";
import {
  type DateRange,
  NZ_TZ,
  SERVICE_START_HOUR,
  nzServiceDayRange,
  nzServiceDayString,
  padScanRange,
  serviceDatesInRange,
  serviceDayScanRange,
} from "@/lib/time";
import type { RouteSummary, StopStats, TopRouteRow } from "@/types/api";
import type {
  ShameDayStop,
  ShameStop,
  ShameStopOfDay,
  ShameStopOfWeek,
  WorstStop,
} from "@/types/dashboard";

/**
 * The cached worst stops for one service day. Same key/TTL ownership as
 * {@link cachedWorstTripsOfDay}.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param mode - Route mode filter (null = every mode).
 * @param includeSchool - Whether school services are included.
 * @param revalidate - TTL for the live day, in seconds.
 * @returns The day's worst stops.
 */
export function cachedWorstStopsOfDay(
  date: string,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  revalidate: number,
): Promise<ShameDayStop[]> {
  return cachedForDay(
    (classified) => worstStopsForRange(nzServiceDayRange(date), mode, includeSchool, classified),
    ["worst-stops-of-day", date, mode ?? "all", includeSchool ? "school" : "no-school"],
    date,
    revalidate,
  );
}

/**
 * Fewest events a stop needs per hour to appear in the Stop Shame hour board.
 * At a stop each calling trip contributes exactly one event, so this reads
 * directly as five services in the hour - the per-stop thresholds need none of
 * the scaling the per-route ones do.
 */
export const MIN_STOP_EVENTS_HOUR = 5;

/** Fewest events - so, calling services - a stop needs to qualify for the worst-stops ranking. */
const MIN_STOP_EVENTS = 20;

/**
 * Every stop's deviation sums for one service day, cached per day. A multi-day
 * worst-stop board adds these up instead of scanning the whole window, so a
 * completed day is scanned once and held for a week, and the current week or
 * month only rescans today.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param mode - Route mode filter (null = every mode).
 * @param includeSchool - Whether school services are included.
 * @param revalidate - TTL for the live day, in seconds.
 * @returns One row per stop that had an arrival that day.
 */
function cachedStopSumsOfDay(
  date: string,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  revalidate: number,
): Promise<StopDaySum[]> {
  return cachedForDay(
    async (classified) => {
      const routeIds = await worstStopRouteIds(mode, includeSchool);
      const match: Record<string, unknown> = {
        scheduledAt: scheduledAtWindow(serviceDayScanRange(date)),
        serviceDate: date,
        ...realDeviationMatchFor(classified),
      };
      if (routeIds) match.routeId = { $in: routeIds };
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            { $match: match },
            {
              $group: {
                _id: "$stopId",
                e: { $sum: 1 },
                d: { $sum: "$deviationSec" },
                a: { $sum: { $abs: "$deviationSec" } },
                r: { $addToSet: "$routeId" },
              },
            },
            { $project: { _id: 0, s: { $toString: "$_id" }, e: 1, d: 1, a: 1, r: 1 } },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: StopDaySum[] } };
      return res.cursor.firstBatch;
    },
    ["stop-sums-of-day-v2", date, mode ?? "all", includeSchool ? "school" : "no-school"],
    date,
    revalidate,
  );
}

/** Raw worst-stop row straight from the aggregation (pre platform-collapse). */
interface WorstStopRaw extends StationRow {
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
    const id = stationId(r.stop_id, r.name, stationPartsOf(r));
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
  // Snap the window to whole service days so the worst-stops card counts the
  // same events as the per-day shame boards. Weeks, months and days already sit
  // on those edges and map to themselves.
  const days = serviceDatesInRange(range);
  const aligned =
    days.length > 0
      ? {
          start: nzServiceDayRange(days[0]).start,
          end: nzServiceDayRange(days[days.length - 1]).end,
        }
      : range;
  // Fetch a generous candidate set so the post-aggregation platform collapse
  // can merge stations and still leave `limit` rows after re-ranking.
  const candidates = Math.max(80, limit * 8);
  if (days.length > 1) {
    return cachedForRange(
      () => worstStopsFromDays(days, mode, includeSchool, limit, candidates, revalidate),
      [
        "worst-stops-days-v2",
        aligned.start.toISOString(),
        aligned.end.toISOString(),
        mode ?? "all",
        includeSchool ? "school" : "no-school",
        String(limit),
      ],
      aligned,
      revalidate,
    );
  }
  return cachedForRange(
    async (classified) => {
      const routeIds = await worstStopRouteIds(mode, includeSchool);
      // A day's readings are its runs' readings, tails past 4am included; a
      // window with no whole day in it has no stamped date to hold to.
      const match: Record<string, unknown> = {
        scheduledAt: scheduledAtWindow(days.length > 0 ? padScanRange(aligned) : aligned),
        ...realDeviationMatchFor(classified),
      };
      if (days.length > 0) match.serviceDate = { $in: days };
      if (routeIds) match.routeId = { $in: routeIds };

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
                ...stationProjection,
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
      "worst-stops-v2",
      aligned.start.toISOString(),
      aligned.end.toISOString(),
      mode ?? "all",
      includeSchool ? "school" : "no-school",
      String(limit),
    ],
    aligned,
    revalidate,
  );
}

/**
 * {@link getWorstStops} for a window of more than one day, added up from each
 * day's cached sums ({@link cachedStopSumsOfDay}) rather than one scan of the
 * whole window: a month scan ran ~9s and, while the month was open, was paid
 * again whenever its cache entry turned over. Days after today are skipped,
 * since they have no arrivals yet. Each day is filtered by its own
 * classification, where the single scan applied the unclassified guard to the
 * whole window until every day in it was classified.
 * @param days - The window's service dates, earliest first.
 * @param mode - Route mode filter (null = every mode).
 * @param includeSchool - Whether school services are included.
 * @param limit - How many ranked stops to return.
 * @param candidates - How many stops to carry into the platform collapse.
 * @param revalidate - TTL for the live day, in seconds.
 * @returns The worst stops, off-schedule magnitude descending.
 */
async function worstStopsFromDays(
  days: string[],
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  limit: number,
  candidates: number,
  revalidate: number,
): Promise<WorstStop[]> {
  const today = nzServiceDayString();
  const perDay = await Promise.all(
    days
      .filter((d) => d <= today)
      .map((d) => cachedStopSumsOfDay(d, mode, includeSchool, revalidate)),
  );
  // Over-fetch past the candidate count: a stop missing from the Stop table is
  // dropped below, as the pipeline's $unwind drops it.
  const ranked = rankStopSums(mergeStopDays(perDay), MIN_STOP_EVENTS, candidates + 20);
  const stops = await prisma.stop.findMany({
    where: { id: { in: ranked.map((r) => r.stopId) } },
    select: { id: true, name: true, parentStation: true, platformCode: true },
  });
  const byId = new Map(stops.map((st) => [st.id, st]));
  const modeMap = mode ? null : await getRouteModeMap();
  const rows: WorstStopRaw[] = [];
  for (const r of ranked) {
    const stop = byId.get(r.stopId);
    if (!stop) continue;
    rows.push({
      stop_id: r.stopId,
      name: stop.name,
      events: r.events,
      avg_delay_sec: Math.round((r.signedSum / r.events) * 10) / 10,
      avg_abs_delay_sec: Math.round((r.absSum / r.events) * 10) / 10,
      routeIds: r.routeIds,
      parent_station: stop.parentStation,
      platform_code: stop.platformCode,
      mode: mode ?? dominantMode(r.routeIds, modeMap!),
    });
    if (rows.length === candidates) break;
  }
  return collapseWorstStops(rows).slice(0, limit);
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
  return cachedForRange(
    async (classified) => {
      const routeIds = await worstStopRouteIds(mode, includeSchool);
      const match: Record<string, unknown> = {
        scheduledAt: scheduledAtWindow(padScanRange(range)),
        serviceDate: { $in: serviceDatesInRange(range) },
        ...realDeviationMatchFor(classified),
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
                  // A run's tail past the day's 4am end reads as 4am-6am on the
                  // clock, which is this board's first slot; it goes in the last
                  // one instead, with the rest of the day's after-midnight calls.
                  // Compared as epoch ms, so no date literal crosses the raw command.
                  hour: {
                    $cond: [
                      { $lt: [{ $toLong: "$scheduledAt" }, range.end.getTime()] },
                      { $hour: { date: "$scheduledAt", timezone: NZ_TZ } },
                      (SERVICE_START_HOUR + 23) % 24,
                    ],
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
      "worst-stops-of-day-v2",
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      includeSchool ? "school" : "no-school",
    ],
    range,
    revalidate,
  );
}

/** Raw per-(serviceDay,stop) row from the Stop Shame week aggregation. */
interface ShameDayStopRaw {
  _id: string; // service date, YYYY-MM-DD
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
  // Resolve each service day independently (cached per day) and combine, so a
  // busy live day never forces one heavy 7-day aggregation. Past days stay
  // cached; only the current day recomputes.
  const days = (
    await Promise.all(
      serviceDatesInRange(range).map((date) =>
        cachedWorstStopsOfDay(date, mode, includeSchool, revalidate),
      ),
    )
  ).flat();
  days.sort((a, b) => a.date.localeCompare(b.date));
  const worst = days.reduce<ShameDayStop | null>(
    (w, d) => (w == null || d.avg_abs_delay_sec > w.avg_abs_delay_sec ? d : w),
    null,
  );
  return { worst, days };
}

/**
 * The worst stop of each service day within a range (one row per day with data).
 * Used per-day by {@link getWorstStopsOfWeek}; left uncached so the caller owns
 * the per-day cache key.
 * @param range - The window to aggregate (typically a single service day).
 * @param mode - Route mode filter (null = all).
 * @param includeSchool - Whether to include school services.
 * @param classified - Whether the day has been through the ghost pass.
 * @returns The per-service-day worst stops.
 */
async function worstStopsForRange(
  range: DateRange,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  classified: boolean,
): Promise<ShameDayStop[]> {
  const routeIds = await worstStopRouteIds(mode, includeSchool);
  const match: Record<string, unknown> = {
    // The pad reaches the tail of a run that started before the boundary; the
    // equality then keeps only the readings that belong to the day, so a run is
    // counted once, whole, on its own day.
    scheduledAt: scheduledAtWindow(padScanRange(range)),
    serviceDate: { $in: serviceDatesInRange(range) },
    ...realDeviationMatchFor(classified),
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
              serviceDay: "$serviceDate",
              stop_id: "$stopId",
            },
            events: { $sum: 1 },
            avg_delay_sec: { $avg: "$deviationSec" },
            avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
            routeIds: { $addToSet: "$routeId" },
          },
        },
        { $match: { events: { $gte: MIN_STOP_EVENTS_HOUR } } },
        // Worst stop per service day via a bounded per-group $top accumulator
        // (one entry per day) rather than a global blocking $sort, which exceeds
        // the cluster's 32MB in-memory sort limit (the tier forbids disk spill).
        {
          $group: {
            _id: "$_id.serviceDay",
            worst: {
              $top: {
                sortBy: { avg_abs_delay_sec: -1 },
                output: {
                  stop_id: "$_id.stop_id",
                  events: "$events",
                  avg_delay_sec: "$avg_delay_sec",
                  avg_abs_delay_sec: "$avg_abs_delay_sec",
                  routeIds: "$routeIds",
                },
              },
            },
          },
        },
        // Resolve the stop name for just the per-day winners.
        { $lookup: { from: "Stop", localField: "worst.stop_id", foreignField: "_id", as: "stop" } },
        { $unwind: "$stop" },
        {
          $project: {
            _id: 1,
            stop_id: { $toString: "$worst.stop_id" },
            name: "$stop.name",
            events: "$worst.events",
            avg_delay_sec: { $round: ["$worst.avg_delay_sec", 1] },
            avg_abs_delay_sec: { $round: ["$worst.avg_abs_delay_sec", 1] },
            routeIds: "$worst.routeIds",
          },
        },
      ] as never,
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as {
    cursor: {
      firstBatch: (Omit<ShameDayStopRaw, "_id"> & { _id: string } & { routeIds: string[] })[];
    };
  };

  const modeMap = mode ? null : await getRouteModeMap();
  return res.cursor.firstBatch.map((r) => ({
    date: r._id,
    stop_id: r.stop_id,
    name: r.name,
    events: r.events,
    avg_delay_sec: r.avg_delay_sec,
    avg_abs_delay_sec: r.avg_abs_delay_sec,
    mode: mode ?? dominantMode(r.routeIds, modeMap!),
  }));
}

/**
 * The parent-keyed station id replacing a legacy name-keyed one, so links minted
 * before stations moved off stop names keep resolving. Returns null when the id
 * is not a legacy one, names no known station, or has no parent in the feed - in
 * all three cases the id the caller holds is already the current one.
 * @param id - A canonical stop id from a link.
 * @returns The current station id to redirect to, or null to stay put.
 */
export async function findCurrentStationId(id: string): Promise<string | null> {
  if (!isLegacyStationId(id)) return null;
  return unstable_cache(
    async () => {
      const platforms = await prisma.stop.findMany({
        where: { name: { contains: "Train Station" } },
        select: { id: true, name: true, parentStation: true, platformCode: true },
      });
      const member = platforms.find(
        (s) => isPlatformStop(s.name, s) && legacyStationId(s.name) === id,
      );
      if (!member) return null;
      const current = stationId(member.id, member.name, member);
      return current === id ? null : current;
    },
    ["current-station-id", id],
    { revalidate: 86_400 },
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
 * slug. A `station:` id expands to every platform of that station; a plain id
 * resolves to itself. Returns null when no such stop exists.
 *
 * The platform ids this returns are what let the stop page match AT's service
 * alerts and scheduled departures, both of which key off raw GTFS stop ids.
 * @param id - The canonical stop id from a link (raw stop id or `station:` id).
 * @returns The resolved group, or null when unknown.
 */
async function resolveStopGroup(id: string): Promise<StopGroup | null> {
  return unstable_cache(
    async () => {
      if (id.startsWith(STATION_PREFIX)) {
        // Parent-keyed ids name their station outright, so the platforms are an
        // indexed lookup. Legacy name-keyed ids predate the parent fields and
        // still have to be matched by scanning the (small) set of train stops.
        const members = isLegacyStationId(id)
          ? (
              await prisma.stop.findMany({
                where: { name: { contains: "Train Station" } },
                select: { id: true, name: true, lat: true, lon: true, platformCode: true },
              })
            ).filter((s) => legacyStationId(s.name) === id)
          : await prisma.stop.findMany({
              where: { parentStation: id.slice(STATION_PREFIX.length) },
              select: { id: true, name: true, lat: true, lon: true, platformCode: true },
            });
        const first = members[0];
        if (first === undefined) return null;
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
  return cachedForRange(
    async (classified) => {
      const group = await resolveStopGroup(id);
      if (!group) return null;

      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            {
              $match: {
                stopId: { $in: group.ids },
                scheduledAt: scheduledAtWindow(padScanRange(range)),
                serviceDate: { $in: serviceDatesInRange(range) },
                ...realDeviationMatchFor(classified),
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
        platform_ids: group.ids,
        summary: facet?.summary[0] ?? null,
        routes: facet?.routes ?? [],
        routes_count: facet?.routeCount[0]?.n ?? 0,
      };
    },
    ["stop-stats-v2", id, range.start.toISOString(), range.end.toISOString(), String(thresholdSec)],
    range,
    revalidate,
  );
}
