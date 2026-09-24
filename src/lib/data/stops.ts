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
import type { DelayDirection } from "@/lib/rankings";
import {
  STATION_PREFIX,
  isLegacyStationId,
  isPlatformStop,
  legacyStationId,
  stationId,
  stationNameOf,
  stationProjection,
} from "@/lib/station";
import {
  type DateRange,
  NZ_TZ,
  SERVICE_START_HOUR,
  nzServiceDayRange,
  padScanRange,
  serviceDatesInRange,
} from "@/lib/time";
import { type RankedStopRow, worstStopOfDay } from "@/lib/worst-stop";
import type { RouteSummary, StopStats, TopRouteRow } from "@/types/api";
import type { ShameDayStop, ShameStop, ShameStopOfDay, ShameStopOfWeek } from "@/types/dashboard";

/**
 * The cached worst stops for one service day. Same key/TTL ownership as
 * {@link cachedWorstTripsOfDay}.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param mode - Route mode filter (null = every mode).
 * @param includeSchool - Whether school services are included.
 * @param direction - Keep only days whose worst station ran late or early on
 *   average; null keeps both, which is what every surface but `/shame/stop` asks for.
 * @param revalidate - TTL for the live day, in seconds.
 * @returns The day's worst stops.
 */
export function cachedWorstStopsOfDay(
  date: string,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  direction: DelayDirection,
  revalidate: number,
): Promise<ShameDayStop[]> {
  return cachedForDay(
    (classified) =>
      worstStopsForRange(nzServiceDayRange(date), mode, includeSchool, direction, classified),
    // The key names stations because a row is now one station rather than one
    // platform: a completed day caches for a week, so an entry written before
    // the merge would keep naming a single platform for that long.
    [
      "worst-stops-of-day-stations",
      date,
      mode ?? "all",
      includeSchool ? "school" : "no-school",
      direction ?? "both",
    ],
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
 * The day's "Stop Shame": the single most off-schedule stop plus the worst stop
 * of each hour for a service window. Only stops with at least
 * {@link MIN_STOP_EVENTS_HOUR} events in that hour qualify. Cached briefly.
 * @param range - The service-day window.
 * @param filter - Mode/school/direction filters.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param filter.direction - Rank only stops running late or early on average;
 *   null/undefined ranks both.
 * @param revalidate - Cache lifetime in seconds.
 * @returns The hour's worst stop and the per-hour worst list, earliest hour first.
 */
export async function getWorstStopsOfDay(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameStopOfDay> {
  const { mode = null, includeSchool = false, direction = null } = filter;
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
            // Direction narrows the candidates, not the board: one row per hour
            // survives the `$group` below, so filtering the rows this returns
            // would leave a Late board holding only the hours whose overall
            // worst also ran late - most of a day blank on a day that ran early.
            // Tested on the rounded average, the figure the row prints, so the
            // board cannot hold a row reading as on time.
            ...(direction
              ? [
                  {
                    $match: {
                      $expr: {
                        [direction === "late" ? "$gt" : "$lt"]: [
                          { $round: ["$avg_delay_sec", 1] },
                          0,
                        ],
                      },
                    },
                  },
                ]
              : []),
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
      direction ?? "both",
    ],
    range,
    revalidate,
  );
}

/**
 * The week's "Stop Shame": the single most off-schedule stop plus the worst stop
 * of each service day over a multi-day window. A day's row is one station, and
 * only stations clearing the whole-day floor across their platforms qualify -
 * the floor lives with {@link worstStopOfDay}. Cached at the supplied revalidate
 * rate.
 * @param range - The week (or multi-day) window.
 * @param filter - Mode/school/direction filters.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param filter.direction - Name only stations running late or early on average;
 *   null/undefined names both.
 * @param revalidate - Cache lifetime in seconds.
 * @returns The period's worst stop and the per-day worst list, earliest day first.
 */
export async function getWorstStopsOfWeek(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameStopOfWeek> {
  const { mode = null, includeSchool = false, direction = null } = filter;
  // Resolve each service day independently (cached per day) and combine, so a
  // busy live day never forces one heavy 7-day aggregation. Past days stay
  // cached; only the current day recomputes.
  const days = (
    await Promise.all(
      serviceDatesInRange(range).map((date) =>
        cachedWorstStopsOfDay(date, mode, includeSchool, direction, revalidate),
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
 * Platforms merge before the floor applies (see {@link worstStopOfDay}), so a row
 * names the station a reader would name rather than one of its platforms, and a
 * station qualifies on all its services rather than its busiest platform's. Used
 * per-day by {@link getWorstStopsOfWeek}; left uncached so the caller owns the
 * per-day cache key.
 * @param range - The window to aggregate (typically a single service day).
 * @param mode - Route mode filter (null = all).
 * @param includeSchool - Whether to include school services.
 * @param direction - Name only stations running late or early on average; null
 *   names both. A day whose qualifying stations all ran the other way has no row.
 * @param classified - Whether the day has been through the ghost pass.
 * @returns The per-service-day worst stops, earliest day first.
 */
async function worstStopsForRange(
  range: DateRange,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  direction: DelayDirection,
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
        // Every stop the day saw, not a ranked head: a station's average is only
        // right with all of its platforms present, and the floor cannot apply
        // until they are merged. One service day per call, so this is a few
        // thousand rows, and the caller holds them for the day.
        { $lookup: { from: "Stop", localField: "_id.stop_id", foreignField: "_id", as: "stop" } },
        { $unwind: "$stop" },
        {
          $project: {
            _id: 0,
            date: "$_id.serviceDay",
            stop_id: { $toString: "$_id.stop_id" },
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
  )) as unknown as { cursor: { firstBatch: (RankedStopRow & { date: string })[] } };

  // Ranked here rather than in the pipeline: merging platforms needs the station
  // rule in station.ts, and sorting a few thousand rows costs nothing here while
  // a blocking $sort on this collection exceeds the cluster's 32MB in-memory
  // limit (the tier forbids disk spill).
  const byDate = new Map<string, RankedStopRow[]>();
  for (const row of res.cursor.firstBatch) {
    const rows = byDate.get(row.date);
    if (rows) rows.push(row);
    else byDate.set(row.date, [row]);
  }

  const modeMap = mode ? null : await getRouteModeMap();
  const days: ShameDayStop[] = [];
  for (const [date, rows] of byDate) {
    const worst = worstStopOfDay(rows, { direction });
    if (!worst) continue;
    const { routeIds: stationRouteIds, ...row } = worst;
    days.push({ date, ...row, mode: mode ?? dominantMode(stationRouteIds, modeMap!) });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
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
    ["current-station-id-v2", id],
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
          name: stationNameOf(members),
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
    ["resolve-stop-group-v2", id],
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
    ["stop-stats-v3", id, range.start.toISOString(), range.end.toISOString(), String(thresholdSec)],
    range,
    revalidate,
  );
}
