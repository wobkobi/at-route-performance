// src/lib/data/shame-routes.ts
// The worst routes: hourly and per-day boards, and the streak batch behind the flame badges.
import { MS_IN_DAY, cachedForDay, cachedForRange, scheduledAtWindow } from "@/lib/data/cache";
import { SCHOOL_BUS_REGEX, type ShameFilter } from "@/lib/data/shame-filter";
import { cachedWorstTripsOfDay } from "@/lib/data/shame-trips";
import { prisma, runCommand } from "@/lib/db";
import { realDeviationMatchFor } from "@/lib/deviation";
import { unstable_cache } from "@/lib/mem-cache";
import { serviceDateExpr } from "@/lib/service-day-expr";
import {
  type DateRange,
  NZ_TZ,
  SERVICE_START_HOUR,
  nzServiceDayRange,
  nzServiceDayString,
  serviceDatesInRange,
  shiftWeek,
} from "@/lib/time";
import type { ShameRouteOfDay, ShameRouteOfWeek, ShameRouteRow } from "@/types/dashboard";

/**
 * The cached worst routes for one service day. Same key/TTL ownership as
 * {@link cachedWorstTripsOfDay}.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param mode - Route mode filter (null = every mode).
 * @param includeSchool - Whether school services are included.
 * @param revalidate - TTL for the live day, in seconds.
 * @returns The day's worst routes.
 */
export function cachedWorstRoutesOfDay(
  date: string,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  revalidate: number,
): Promise<ShameRouteRow[]> {
  return cachedForDay(
    (classified) => worstRoutesForRange(nzServiceDayRange(date), mode, includeSchool, classified),
    ["shame-route-worst-of-day", date, mode ?? "all", includeSchool ? "school" : "no-school"],
    date,
    revalidate,
  );
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
                    timezone: NZ_TZ,
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
      // Require day-on-day adjacency so a date with no summary row breaks the
      // run instead of being silently bridged.
      let count = 0;
      let expectedDate: string | null = null;
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (row === undefined) break;
        if (expectedDate !== null && row.date !== expectedDate) break;
        if (row.topRouteId === routeId) {
          count++;
          expectedDate = shiftWeek(row.date, -1);
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
 * @returns Map of routeId to `{ count, prevHours, prevWorstOfDayDays }` - streak
 *   length (min 1), total hourly-slot appearances across *previous* streak days,
 *   and the count of consecutive prior days on which this route was also the
 *   worst of the day (highest avg absolute delay across all slots).
 */
export async function getShameRouteStreaksBatch(
  routeIds: string[],
  currentRange: DateRange,
  filter: ShameFilter,
): Promise<Map<string, { count: number; prevHours: number; prevWorstOfDayDays: number }>> {
  if (routeIds.length === 0) return new Map();
  const { mode = null, includeSchool = false } = filter;

  // Cache keyed only by day+filter, NOT by routeIds. The pipeline scans all
  // routes anyway; including routeIds in the key caused a cache miss whenever
  // the visible route set grew during the day, re-running the full 14-day
  // aggregation on every new hourly cycle.
  const fourteenDaysAgo = new Date(currentRange.start.getTime() - 14 * MS_IN_DAY);
  const firstBatch = await cachedForRange(
    async (classified) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipeline: any[] = [
        {
          $match: {
            scheduledAt: {
              $gte: { $date: fourteenDaysAgo.toISOString() },
              $lt: { $date: currentRange.start.toISOString() },
            },
            ...realDeviationMatchFor(classified),
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
        // Service date as the shame pages label it, so the buckets match their
        // day links (every service-day board shares this expression).
        {
          $addFields: {
            serviceDay: serviceDateExpr("$trip_start"),
            hour: { $hour: { date: "$trip_start", timezone: NZ_TZ } },
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
        // single-slot delay - matching the page's worst-of-day criterion.
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
    // The 14-day window ends at the current day's start, so it never includes
    // the live day; it is held long once yesterday's summary exists and
    // refreshed hourly until then.
    { start: fourteenDaysAgo, end: currentRange.start },
    3600,
  );

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
    // Step by date string, not fixed 24h of milliseconds: a millisecond step
    // drifts an hour off the 5am boundary across a DST change and skips a day.
    let dayKey = shiftWeek(nzServiceDayString(currentRange.start), -1);
    for (let d = 0; d < 14; d++) {
      const daySet = shameDays.get(dayKey);
      if (!daySet || !daySet.has(routeId)) break;
      count++;
      prevHours += routeHoursPerDay.get(dayKey)?.get(routeId) ?? 0;
      // Consecutive worst-of-day run from yesterday backwards.
      if (d === prevWorstOfDayDays && worstOfDayPerDay.get(dayKey) === routeId) {
        prevWorstOfDayDays++;
      }
      dayKey = shiftWeek(dayKey, -1);
    }
    result.set(routeId, { count, prevHours, prevWorstOfDayDays });
  }
  return result;
}

/**
 * Fewest arrival events a route needs in an hour to qualify for the Route Shame
 * board. Counted in stop visits, not trips: one run of a 30-stop route lands ~30
 * events here, so this is roughly a single run's worth - low enough to keep a
 * quiet hour on the board, high enough that a couple of stray stop readings
 * cannot nominate an hour.
 */
const MIN_ROUTE_EVENTS_HOUR = 30;

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
 * @param classified - Whether every day in the window has been through the ghost pass.
 * @param groupKey - Name of the field computed by `addFieldsStage`.
 * @param addFieldsStage - `$addFields` stage that computes `groupKey` from `$trip_start`.
 * @returns The partial pipeline array.
 */
function routeShamePipelineBase(
  range: DateRange,
  mode: string | null,
  includeSchool: boolean,
  classified: boolean,
  groupKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addFieldsStage: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any[] = [
    {
      $match: {
        scheduledAt: scheduledAtWindow(range),
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
  return cachedForRange(
    async (classified) => {
      const pipeline = routeShamePipelineBase(range, mode, includeSchool, classified, "hour", {
        hour: { $hour: { date: "$trip_start", timezone: NZ_TZ } },
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
    range,
    revalidate,
  );
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
  // Resolve each service day independently (cached per day) and combine, so a
  // busy live day never forces one heavy 7-day aggregation.
  const days = (
    await Promise.all(
      serviceDatesInRange(range).map((date) =>
        cachedWorstRoutesOfDay(date, mode, includeSchool, revalidate),
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
 * data). Used per-day by {@link getShameRouteOfWeek}; left uncached so the
 * caller owns the per-day cache key.
 * @param range - The window to aggregate (typically a single service day).
 * @param mode - Route mode filter (null = all).
 * @param includeSchool - Whether to include school services.
 * @param classified - Whether the day has been through the ghost pass.
 * @returns The per-service-day worst routes.
 */
async function worstRoutesForRange(
  range: DateRange,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  classified: boolean,
): Promise<ShameRouteRow[]> {
  const pipeline = routeShamePipelineBase(range, mode, includeSchool, classified, "serviceDay", {
    serviceDay: serviceDateExpr("$trip_start"),
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
              route_id: "$_id.routeId",
              short_name: "$route.shortName",
              long_name: "$route.longName",
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
        route_id: "$worst.route_id",
        short_name: "$worst.short_name",
        long_name: "$worst.long_name",
        mode: "$worst.mode",
        colour: "$worst.colour",
        events: "$worst.events",
        avg_abs_delay_sec: { $round: ["$worst.avg_abs_delay_sec", 1] },
        avg_delay_sec: { $round: ["$worst.avg_delay_sec", 1] },
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
    cursor: { firstBatch: (Omit<ShameRouteRaw, "hour"> & { _id: string })[] };
  };

  return res.cursor.firstBatch.map((r) => ({
    hour: 0,
    date: r._id,
    route_id: r.route_id,
    short_name: r.short_name ?? null,
    long_name: r.long_name ?? "",
    mode: r.mode ?? "BUS",
    colour: r.colour ?? null,
    events: r.events,
    avg_abs_delay_sec: r.avg_abs_delay_sec,
    avg_delay_sec: r.avg_delay_sec,
  }));
}
