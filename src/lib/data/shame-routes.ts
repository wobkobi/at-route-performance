// src/lib/data/shame-routes.ts
// The worst routes: hourly and per-day boards.
import { cachedForDay, cachedForRange, scheduledAtWindow } from "@/lib/data/cache";
import { aggregateRows } from "@/lib/data/raw";
import { type ShameFilter, schoolRouteMatch } from "@/lib/data/shame-filter";
import { SHAME_RANKED_LIMIT, cachedTripBoardOfDay } from "@/lib/data/shame-trips";
import { realDeviationMatchFor } from "@/lib/deviation";
import { type Mode, modeOrBus } from "@/lib/mode";
import { type SchoolFilter } from "@/lib/school-bus";
import {
  type DateRange,
  NZ_TZ,
  SERVICE_START_HOUR,
  nzServiceDayRange,
  padScanRange,
  serviceDatesInRange,
} from "@/lib/time/service-day";
import { type HourRange, hoursInRange } from "@/lib/time/time-of-day";
import type {
  ShameRanked,
  ShameRouteOfDay,
  ShameRouteOfWeek,
  ShameRouteRow,
} from "@/types/dashboard";

/**
 * The cached worst routes for one service day. Same key/TTL ownership as
 * {@link cachedTripBoardOfDay}.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param mode - Route mode filter (null = every mode).
 * @param schools - Which school services count (default leave them out).
 * @param revalidate - TTL for the live day, in seconds.
 * @returns The day's worst routes.
 */
export function cachedRouteBoardOfDay(
  date: string,
  mode: Mode | null,
  schools: SchoolFilter,
  revalidate: number,
): Promise<ShameRouteRow[]> {
  return cachedForDay(
    (classified) => worstRoutesForRange(nzServiceDayRange(date), mode, schools, classified),
    ["shame-route-worst-of-day", date, mode ?? "all", schools],
    date,
    revalidate,
  );
}

/**
 * Fewest arrival events a route needs in an hour to qualify for the Route Shame
 * board. Counted in stop visits, not trips: one run of a 30-stop route lands ~30
 * events here, so this is roughly a single run's worth - low enough to keep a
 * quiet hour on the board, high enough that a couple of stray stop readings
 * cannot nominate an hour.
 */
export const MIN_ROUTE_EVENTS_HOUR = 30;

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
 * @param schools - Which school services count (default leave them out).
 * @param classified - Whether every day in the window has been through the ghost pass.
 * @param groupKey - Name of the field computed by `addFieldsStage`.
 * @param addFieldsStage - `$addFields` stage that computes `groupKey` from the
 *   grouped run (`$trip_start` for a clock bucket, `$service_date` for a day).
 * @param tripHours - Keep only runs starting in these Auckland clock hours;
 *   null keeps every run.
 * @returns The partial pipeline array.
 */
function routeShamePipelineBase(
  range: DateRange,
  mode: string | null,
  schools: SchoolFilter,
  classified: boolean,
  groupKey: string,
  addFieldsStage: Record<string, unknown>,
  tripHours: number[] | null = null,
): object[] {
  const pipeline: object[] = [
    {
      $match: {
        scheduledAt: scheduledAtWindow(padScanRange(range)),
        serviceDate: { $in: serviceDatesInRange(range) },
        ...realDeviationMatchFor(classified),
      },
    },
    // Collapse to one row per (routeId, tripId) so the time bucket uses trip
    // start time, not individual stop times. This keeps overnight routes from
    // bleeding into post-midnight hour slots they don't actually start in.
    {
      $group: {
        _id: { routeId: "$routeId", tripId: "$tripId" },
        trip_start: { $min: "$scheduledAt" },
        // $min, not $first: $first is order-dependent without a preceding
        // $sort, so a run whose readings disagreed would bucket at random.
        service_date: { $min: "$serviceDate" },
        events: { $sum: 1 },
        avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
        avg_delay_sec: { $avg: "$deviationSec" },
      },
    },
    ...(tripHours
      ? [
          {
            $match: {
              $expr: { $in: [{ $hour: { date: "$trip_start", timezone: NZ_TZ } }, tripHours] },
            },
          },
        ]
      : []),
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
  const schoolStage = schoolRouteMatch(schools);
  if (schoolStage) pipeline.push(schoolStage);
  return pipeline;
}

/** Raw route-shame row from the aggregation cursor. */
interface ShameRouteRaw {
  hour: number;
  routeId: string;
  shortName: string | null;
  longName: string | null;
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
 * @param filter.schools - Which school services count (default leave them out).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The period's worst route and the per-hour worst list.
 */
export async function getRouteBoardOfDay(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameRouteOfDay> {
  const { mode = null, schools = "exclude" } = filter;
  return cachedForRange(
    async (classified) => {
      const pipeline = routeShamePipelineBase(range, mode, schools, classified, "hour", {
        hour: { $hour: { date: "$trip_start", timezone: NZ_TZ } },
      });
      pipeline.push(
        { $sort: { avg_abs_delay_sec: -1 } },
        {
          $group: {
            _id: "$_id.hour",
            routeId: { $first: "$_id.routeId" },
            shortName: { $first: "$route.shortName" },
            longName: { $first: "$route.longName" },
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
            routeId: 1,
            shortName: 1,
            longName: 1,
            mode: 1,
            colour: 1,
            events: 1,
            avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
            avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
          },
        },
      );
      const res = await aggregateRows<ShameRouteRaw>("ArrivalEvent", pipeline);

      const hours: ShameRouteRow[] = res.map((r) => ({
        hour: r.hour,
        routeId: r.routeId,
        shortName: r.shortName ?? null,
        longName: r.longName ?? "",
        mode: modeOrBus(r.mode),
        colour: r.colour ?? null,
        events: r.events,
        avg_abs_delay_sec: r.avg_abs_delay_sec,
        avg_delay_sec: r.avg_delay_sec,
      }));
      // Service-day order: 4am is first, post-midnight runs (12am-3am) are last.
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
      schools,
    ],
    range,
    revalidate,
  );
}

/**
 * Every route in part of the day, worst first: the list a route board's hour
 * opens on. A route's figures pool every run starting in those hours, and it
 * qualifies on the hourly board's floor of {@link MIN_ROUTE_EVENTS_HOUR}
 * arrivals, so the top row of a single hour is the route the hourly board names
 * for it. Ranked with one bounded `$topN`, as the trips list is.
 * @param range - The service-day window.
 * @param filter - Mode/school filters.
 * @param hours - The part of the day, as Auckland clock hours.
 * @param revalidate - Cache lifetime in seconds.
 * @returns Up to {@link SHAME_RANKED_LIMIT} routes, worst first, and how many qualified.
 */
export async function getRouteBoardInHours(
  range: DateRange,
  filter: ShameFilter,
  hours: HourRange,
  revalidate: number,
): Promise<ShameRanked<ShameRouteRow>> {
  const { mode = null, schools = "exclude" } = filter;
  const hourSet = hoursInRange(hours);
  return cachedForRange(
    async (classified) => {
      // One bucket for the whole range, so each route is one row.
      const pipeline = routeShamePipelineBase(
        range,
        mode,
        schools,
        classified,
        "slot",
        { slot: { $literal: 0 } },
        hourSet,
      );
      pipeline.push({
        $group: {
          _id: null,
          total: { $sum: 1 },
          rows: {
            $topN: {
              n: SHAME_RANKED_LIMIT,
              sortBy: { avg_abs_delay_sec: -1 },
              output: {
                routeId: "$_id.routeId",
                shortName: "$route.shortName",
                longName: "$route.longName",
                mode: "$route.mode",
                colour: "$route.colour",
                events: "$events",
                avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
                avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
              },
            },
          },
        },
      });
      const res = await aggregateRows<{ total: number; rows: Omit<ShameRouteRaw, "hour">[] }>(
        "ArrivalEvent",
        pipeline,
      );
      const doc = res[0];
      return {
        total: doc?.total ?? 0,
        rows: (doc?.rows ?? []).map((r) => ({
          hour: hours.from,
          routeId: r.routeId,
          shortName: r.shortName ?? null,
          longName: r.longName ?? "",
          mode: modeOrBus(r.mode),
          colour: r.colour ?? null,
          events: r.events,
          avg_abs_delay_sec: r.avg_abs_delay_sec,
          avg_delay_sec: r.avg_delay_sec,
        })),
      };
    },
    [
      "shame-routes-in-hours",
      `top${SHAME_RANKED_LIMIT}`,
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      schools,
      hourSet.join(","),
    ],
    range,
    revalidate,
  );
}

/**
 * The week's "Shame of the Week" for routes: the single most off-schedule route
 * plus the worst route of each service day. Groups `ArrivalEvent` by
 * `(routeId, serviceDay)`. Mirrors {@link getRouteBoardOfDay} but for the week
 * view. Cached at the supplied revalidate rate.
 * @param range - The week (or multi-day) window.
 * @param filter - Mode/school filters.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.schools - Which school services count (default leave them out).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The period's worst route and the per-day worst list, earliest day first.
 */
export async function getRouteBoardOfWeek(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameRouteOfWeek> {
  const { mode = null, schools = "exclude" } = filter;
  // Resolve each service day independently (cached per day) and combine, so a
  // busy live day never forces one heavy 7-day aggregation.
  const days = (
    await Promise.all(
      serviceDatesInRange(range).map((date) =>
        cachedRouteBoardOfDay(date, mode, schools, revalidate),
      ),
    )
  ).flat();
  days.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const worst = days.reduce<ShameRouteRow | null>(
    (w, d) => (w == null || d.avg_abs_delay_sec > w.avg_abs_delay_sec ? d : w),
    null,
  );
  return { worst, days };
}

/**
 * The worst route of each service day within a range (one row per day with
 * data). Used per-day by {@link getRouteBoardOfWeek}; left uncached so the
 * caller owns the per-day cache key.
 * @param range - The window to aggregate (typically a single service day).
 * @param mode - Route mode filter (null = all).
 * @param schools - Which school services count (default leave them out).
 * @param classified - Whether the day has been through the ghost pass.
 * @returns The per-service-day worst routes.
 */
async function worstRoutesForRange(
  range: DateRange,
  mode: Mode | null,
  schools: SchoolFilter,
  classified: boolean,
): Promise<ShameRouteRow[]> {
  const pipeline = routeShamePipelineBase(range, mode, schools, classified, "serviceDay", {
    serviceDay: "$service_date",
  });
  pipeline.push(
    // Worst route per service day via a bounded per-group $top (one row per day)
    // instead of a global blocking $sort, which can exceed the cluster's 32MB
    // in-memory sort limit (the tier forbids disk spill).
    {
      $group: {
        _id: "$_id.serviceDay",
        worst: {
          $top: {
            sortBy: { avg_abs_delay_sec: -1 },
            output: {
              routeId: "$_id.routeId",
              shortName: "$route.shortName",
              longName: "$route.longName",
              mode: "$route.mode",
              colour: "$route.colour",
              events: "$events",
              avg_abs_delay_sec: "$avg_abs_delay_sec",
              avg_delay_sec: "$avg_delay_sec",
            },
          },
        },
      },
    },
    {
      $project: {
        _id: 1,
        routeId: "$worst.routeId",
        shortName: "$worst.shortName",
        longName: "$worst.longName",
        mode: "$worst.mode",
        colour: "$worst.colour",
        events: "$worst.events",
        avg_abs_delay_sec: { $round: ["$worst.avg_abs_delay_sec", 1] },
        avg_delay_sec: { $round: ["$worst.avg_delay_sec", 1] },
      },
    },
  );
  const res = await aggregateRows<Omit<ShameRouteRaw, "hour"> & { _id: string }>(
    "ArrivalEvent",
    pipeline,
  );

  return res.map((r) => ({
    hour: 0,
    date: r._id,
    routeId: r.routeId,
    shortName: r.shortName ?? null,
    longName: r.longName ?? "",
    mode: modeOrBus(r.mode),
    colour: r.colour ?? null,
    events: r.events,
    avg_abs_delay_sec: r.avg_abs_delay_sec,
    avg_delay_sec: r.avg_delay_sec,
  }));
}
