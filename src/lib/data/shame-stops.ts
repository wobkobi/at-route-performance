// src/lib/data/shame-stops.ts
// The stop board: the worst stops of a day, a week and part of a day.
import { groupBy, pushTo } from "@/lib/collections";
import { cachedForDay, cachedForRange, scheduledAtWindow } from "@/lib/data/cache";
import { aggregateRows } from "@/lib/data/raw";
import { getRouteModeMap } from "@/lib/data/routes";
import { type ShameFilter, worstStopRouteIds } from "@/lib/data/shame-filter";
import { SHAME_RANKED_LIMIT, cachedTripBoardOfDay } from "@/lib/data/shame-trips";
import { realDeviationMatchFor } from "@/lib/deviation";
import type { Mode } from "@/lib/mode";
import type { DelayDirection } from "@/lib/rankings";
import { type SchoolFilter } from "@/lib/school-bus";
import { stationIdExpr, stationProjection } from "@/lib/stop/station";
import {
  MIN_STOP_EVENTS,
  type RankedStopRow,
  matchesDelayDirection,
  mergeStationPlatforms,
  worstStopOfDay,
} from "@/lib/stop/worst-stop";
import {
  type DateRange,
  NZ_TZ,
  SERVICE_START_HOUR,
  nzServiceDayRange,
  padScanRange,
  serviceDatesInRange,
  startedServiceDates,
} from "@/lib/time/service-day";
import { type HourRange, hoursInRange } from "@/lib/time/time-of-day";
import type {
  ShameDayStop,
  ShameRanked,
  ShameStop,
  ShameStopOfDay,
  ShameStopOfWeek,
} from "@/types/dashboard";

/**
 * The cached worst stops for one service day. Same key/TTL ownership as
 * {@link cachedTripBoardOfDay}.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param mode - Route mode filter (null = every mode).
 * @param schools - Which school services count (default leave them out).
 * @param direction - Keep only days whose worst station ran late or early on
 *   average; null keeps both, which is what every surface but `/shame/stop` asks for.
 * @param revalidate - TTL for the live day, in seconds.
 * @returns The day's worst stops.
 */
export function cachedStopBoardOfDay(
  date: string,
  mode: Mode | null,
  schools: SchoolFilter,
  direction: DelayDirection,
  revalidate: number,
): Promise<ShameDayStop[]> {
  return cachedForDay(
    (classified) =>
      worstStopsForRange(nzServiceDayRange(date), mode, schools, direction, classified),
    // The key names stations because a row is now one station rather than one
    // platform: a completed day caches for a week, so an entry written before
    // the merge would keep naming a single platform for that long.
    ["worst-stops-of-day-stations", date, mode ?? "all", schools, direction ?? "both"],
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
function dominantMode(routeIds: string[], modeMap: Map<string, Mode>): Mode {
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
 * Stations per hour the Stop Shame aggregation returns for the final ranking.
 * The pipeline orders on the raw average, while {@link worstStopOfDay} orders on
 * the figure rounded to a tenth and re-tests the direction on the rounded signed
 * average, so the raw leader can tie a runner-up or drop out; a handful of
 * runners-up covers both without sending every station back.
 */
const HOUR_CANDIDATES = 10;

/**
 * The day's "Stop Shame": the single most off-schedule station plus the worst
 * station of each hour for a service window. Platforms merge into their station
 * first, so a row names the station a reader would name; only stations with at
 * least {@link MIN_STOP_EVENTS_HOUR} events in that hour qualify. Cached briefly.
 * @param range - The service-day window.
 * @param filter - Mode/school/direction filters.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.schools - Which school services count (default leave them out).
 * @param filter.direction - Rank only stops running late or early on average;
 *   null/undefined ranks both.
 * @param revalidate - Cache lifetime in seconds.
 * @returns The hour's worst stop and the per-hour worst list, earliest hour first.
 */
export async function getStopBoardOfDay(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameStopOfDay> {
  const { mode = null, schools = "exclude", direction = null } = filter;
  return cachedForRange(
    async (classified) => {
      const routeIds = await worstStopRouteIds(mode, schools);
      const match: Record<string, unknown> = {
        scheduledAt: scheduledAtWindow(padScanRange(range)),
        serviceDate: { $in: serviceDatesInRange(range) },
        ...realDeviationMatchFor(classified),
      };
      if (routeIds) match.routeId = { $in: routeIds };

      const res = await aggregateRows<RankedStopRow & { hour: number }>("ArrivalEvent", [
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
        // Folded to one document per stop so the Stop lookup runs a few
        // thousand times rather than once per hour of every stop.
        {
          $group: {
            _id: "$_id.stop_id",
            hours: {
              $push: {
                hour: "$_id.hour",
                events: "$events",
                avg_delay_sec: "$avg_delay_sec",
                avg_abs_delay_sec: "$avg_abs_delay_sec",
                routeIds: "$routeIds",
              },
            },
          },
        },
        { $lookup: { from: "Stop", localField: "_id", foreignField: "_id", as: "stop" } },
        { $unwind: "$stop" },
        // The joined stop goes once its station is known: carried into the
        // group below it multiplies that stage's time several times over.
        { $project: { hours: 1, station: stationIdExpr } },
        { $unwind: "$hours" },
        // A stop that is its own station is its whole station, so an hour below
        // the floor can never clear it and goes before the group. Platforms
        // only clear the floor together, so theirs stay. Most rows go here,
        // which keeps the group under the memory limit past which it spills
        // to disk.
        {
          $match: {
            $or: [
              { "hours.events": { $gte: MIN_STOP_EVENTS_HOUR } },
              { $expr: { $ne: ["$station", { $toString: "$_id" }] } },
            ],
          },
        },
        // Each hour's platforms merged into their station, so the floor applies
        // to the station's services together, as worstStopOfDay applies it.
        // The stop ids and hour figures are pushed as they stand, in step, and
        // zipped back into rows only for the stations that make the cut.
        {
          $group: {
            _id: { hour: "$hours.hour", station: "$station" },
            events: { $sum: "$hours.events" },
            absSum: { $sum: { $multiply: ["$hours.avg_abs_delay_sec", "$hours.events"] } },
            signedSum: {
              $sum: { $multiply: [{ $ifNull: ["$hours.avg_delay_sec", 0] }, "$hours.events"] },
            },
            stopIds: { $push: "$_id" },
            figures: { $push: "$hours" },
          },
        },
        // The direction test here is on the raw sign, which the rounded
        // figure worstStopOfDay tests can only narrow, never widen.
        {
          $match: {
            events: { $gte: MIN_STOP_EVENTS_HOUR },
            ...(direction === "late" ? { signedSum: { $gt: 0 } } : {}),
            ...(direction === "early" ? { signedSum: { $lt: 0 } } : {}),
          },
        },
        { $addFields: { abs: { $divide: ["$absSum", "$events"] } } },
        // Only each hour's leading stations come back, with their platform rows,
        // so the reply is a few hundred rows rather than every stop's every hour.
        {
          $group: {
            _id: "$_id.hour",
            top: {
              $topN: {
                n: HOUR_CANDIDATES,
                sortBy: { abs: -1, "_id.station": 1 },
                output: { stopIds: "$stopIds", figures: "$figures" },
              },
            },
          },
        },
        { $unwind: "$top" },
        { $unwind: { path: "$top.stopIds", includeArrayIndex: "i" } },
        {
          $project: {
            _id: 0,
            hour: "$_id",
            stopId: "$top.stopIds",
            f: { $arrayElemAt: ["$top.figures", "$i"] },
          },
        },
        { $lookup: { from: "Stop", localField: "stopId", foreignField: "_id", as: "stop" } },
        { $unwind: "$stop" },
        {
          $project: {
            hour: 1,
            stop_id: { $toString: "$stopId" },
            name: "$stop.name",
            ...stationProjection,
            events: "$f.events",
            avg_delay_sec: "$f.avg_delay_sec",
            avg_abs_delay_sec: "$f.avg_abs_delay_sec",
            routeIds: "$f.routeIds",
          },
        },
      ]);

      const byHour = new Map<number, RankedStopRow[]>();
      for (const { hour, ...row } of res) {
        pushTo(byHour, hour, row);
      }

      // Direction narrows each hour's candidates, not the board: filtering the
      // winners instead would leave a Late board holding only the hours whose
      // overall worst also ran late - most of a day blank on a day that ran early.
      const modeMap = mode ? null : await getRouteModeMap();
      const hours: ShameStop[] = [];
      for (const [hour, rows] of byHour) {
        const top = worstStopOfDay(rows, { minEvents: MIN_STOP_EVENTS_HOUR, direction });
        if (!top) continue;
        const { routeIds: stationRouteIds, ...row } = top;
        hours.push({ hour, ...row, mode: mode ?? dominantMode(stationRouteIds, modeMap!) });
      }
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
      "worst-stops-of-day-v3",
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      schools,
      direction ?? "both",
    ],
    range,
    revalidate,
  );
}

/**
 * Every station in part of the day, worst first: the list a stop board's hour
 * opens on. Calls are bucketed by the hour they were scheduled at, platforms
 * merge into their station before the floor applies, and the direction filter
 * runs on the merged row, all as on the hourly board. The floor is
 * {@link MIN_STOP_EVENTS_HOUR} per hour covered, capped at the whole-day
 * {@link MIN_STOP_EVENTS}, so a single hour ranks exactly the stations the hourly
 * board chose among, and a long stretch of the day still asks a real sample.
 * @param range - The service-day window.
 * @param filter - Mode/school/direction filters.
 * @param hours - The part of the day, as Auckland clock hours.
 * @param revalidate - Cache lifetime in seconds.
 * @returns Up to {@link SHAME_RANKED_LIMIT} stations, worst first, and how many qualified.
 */
export async function getStopBoardInHours(
  range: DateRange,
  filter: ShameFilter,
  hours: HourRange,
  revalidate: number,
): Promise<ShameRanked<ShameStop>> {
  const { mode = null, schools = "exclude", direction = null } = filter;
  const hourSet = hoursInRange(hours);
  return cachedForRange(
    async (classified) => {
      const routeIds = await worstStopRouteIds(mode, schools);
      const match: Record<string, unknown> = {
        scheduledAt: scheduledAtWindow(padScanRange(range)),
        serviceDate: { $in: serviceDatesInRange(range) },
        ...realDeviationMatchFor(classified),
      };
      if (routeIds) match.routeId = { $in: routeIds };

      const res = await aggregateRows<RankedStopRow>("ArrivalEvent", [
        { $match: match },
        // The hourly board's bucket, tail rule included (see getStopBoardOfDay).
        {
          $addFields: {
            hour: {
              $cond: [
                { $lt: [{ $toLong: "$scheduledAt" }, range.end.getTime()] },
                { $hour: { date: "$scheduledAt", timezone: NZ_TZ } },
                (SERVICE_START_HOUR + 23) % 24,
              ],
            },
          },
        },
        { $match: { hour: { $in: hourSet } } },
        {
          $group: {
            _id: "$stopId",
            events: { $sum: 1 },
            avg_delay_sec: { $avg: "$deviationSec" },
            avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
            routeIds: { $addToSet: "$routeId" },
          },
        },
        { $lookup: { from: "Stop", localField: "_id", foreignField: "_id", as: "stop" } },
        { $unwind: "$stop" },
        {
          $project: {
            _id: 0,
            stop_id: { $toString: "$_id" },
            name: "$stop.name",
            events: 1,
            avg_delay_sec: 1,
            avg_abs_delay_sec: 1,
            routeIds: 1,
            ...stationProjection,
          },
        },
      ]);

      const minEvents = Math.min(MIN_STOP_EVENTS, MIN_STOP_EVENTS_HOUR * hourSet.length);
      const ranked = mergeStationPlatforms(res).filter(
        (r) => r.events >= minEvents && matchesDelayDirection(r, direction),
      );
      const modeMap = mode ? null : await getRouteModeMap();
      return {
        total: ranked.length,
        rows: ranked.slice(0, SHAME_RANKED_LIMIT).map(({ routeIds: stationRouteIds, ...row }) => ({
          hour: hours.from,
          ...row,
          mode: mode ?? dominantMode(stationRouteIds, modeMap!),
        })),
      };
    },
    [
      "shame-stops-in-hours",
      `top${SHAME_RANKED_LIMIT}`,
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      schools,
      direction ?? "both",
      hourSet.join(","),
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
 * @param filter.schools - Which school services count (default leave them out).
 * @param filter.direction - Name only stations running late or early on average;
 *   null/undefined names both.
 * @param revalidate - Cache lifetime in seconds.
 * @returns The period's worst stop and the per-day worst list, earliest day first.
 */
export async function getStopBoardOfWeek(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameStopOfWeek> {
  const { mode = null, schools = "exclude", direction = null } = filter;
  // Resolve each started service day independently (cached per day) and combine, so a
  // busy live day never forces one heavy 7-day aggregation. Past days stay
  // cached; only the current day recomputes.
  const days = (
    await Promise.all(
      startedServiceDates(range).map((date) =>
        cachedStopBoardOfDay(date, mode, schools, direction, revalidate),
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
 * per-day by {@link getStopBoardOfWeek}; left uncached so the caller owns the
 * per-day cache key.
 * @param range - The window to aggregate (typically a single service day).
 * @param mode - Route mode filter (null = all).
 * @param schools - Which school services count (default leave them out).
 * @param direction - Name only stations running late or early on average; null
 *   names both. A day whose qualifying stations all ran the other way has no row.
 * @param classified - Whether the day has been through the ghost pass.
 * @returns The per-service-day worst stops, earliest day first.
 */
async function worstStopsForRange(
  range: DateRange,
  mode: Mode | null,
  schools: SchoolFilter,
  direction: DelayDirection,
  classified: boolean,
): Promise<ShameDayStop[]> {
  const routeIds = await worstStopRouteIds(mode, schools);
  const match: Record<string, unknown> = {
    // The pad reaches the tail of a run that started before the boundary; the
    // equality then keeps only the readings that belong to the day, so a run is
    // counted once, whole, on its own day.
    scheduledAt: scheduledAtWindow(padScanRange(range)),
    serviceDate: { $in: serviceDatesInRange(range) },
    ...realDeviationMatchFor(classified),
  };
  if (routeIds) match.routeId = { $in: routeIds };

  const res = await aggregateRows<RankedStopRow & { date: string }>("ArrivalEvent", [
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
  ]);

  // Ranked here rather than in the pipeline: merging platforms needs the station
  // rule in stop/station.ts, and sorting a few thousand rows costs nothing here
  // while a blocking $sort on this collection exceeds the cluster's 32MB
  // in-memory limit (the tier forbids disk spill).
  const byDate = groupBy(res, (r) => r.date);

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
