// src/lib/data/shame-routes.ts
// The worst routes: hourly and per-day boards, and the streak batch behind the flame badges.
import { cachedForDay, cachedForRange, scheduledAtWindow } from "@/lib/data/cache";
import { type ShameFilter, schoolRouteMatch } from "@/lib/data/shame-filter";
import { SHAME_RANKED_LIMIT, cachedWorstTripsOfDay } from "@/lib/data/shame-trips";
import { prisma, runCommand } from "@/lib/db";
import { realDeviationMatchFor } from "@/lib/deviation";
import { unstable_cache } from "@/lib/mem-cache";
import { type SchoolFilter } from "@/lib/school-bus";
import {
  type DateRange,
  NZ_TZ,
  SERVICE_START_HOUR,
  nzServiceDayRange,
  nzServiceDayString,
  padScanRange,
  serviceDatesInRange,
  shiftWeek,
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
 * {@link cachedWorstTripsOfDay}.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param mode - Route mode filter (null = every mode).
 * @param schools - Which school services count (default leave them out).
 * @param revalidate - TTL for the live day, in seconds.
 * @returns The day's worst routes.
 */
export function cachedWorstRoutesOfDay(
  date: string,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
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
      // The start of the service day six days back, found by date rather than
      // by 7 x 24h of milliseconds: that lands an hour off 4am across a DST
      // change, and when the clocks go back it misses the first day's summary.
      const sevenDaysAgo = nzServiceDayRange(
        shiftWeek(nzServiceDayString(currentRange.start), -6),
      ).start;
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

/** Longest streak a route can carry back from today, in prior days. */
const STREAK_DAYS = 14;

/** One day's hourly shame slots: which route was worst of the day, and each route's hour count. */
interface DayShameSlots {
  worstOfDayRouteId: string;
  hours: Map<string, number>;
}

/**
 * Misses in flight on this instance, by cache key. `unstable_cache` does not fold
 * concurrent misses together, so without this every request that arrived while a
 * day was being computed ran the same aggregation again alongside it.
 */
const slotsInFlight = new Map<string, Promise<DayShameSlots | null>>();

/**
 * One service day's hourly worst-route slots, for the streak walk in
 * {@link getShameRouteStreaksBatch}: group by run > bucket by the run's start
 * hour > pick the worst route per hour > count each route's hours. The
 * worst-of-day route is the one with the highest single-slot delay, the page's
 * own worst-of-day criterion.
 *
 * Cached per day rather than per fortnight: a closed, summarised day never
 * changes, so it holds for a week and each new day costs one day's scan. A
 * fortnight in one aggregation read half of ArrivalEvent on every miss, some
 * four minutes on the database, and the misses piled up behind each other.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param mode - Route mode filter (null = every mode).
 * @param schools - Which school services count (default leave them out).
 * @returns The day's slots, or null for a day with no qualifying hour.
 */
function shameSlotsOfDay(
  date: string,
  mode: string | null,
  schools: SchoolFilter,
): Promise<DayShameSlots | null> {
  const key = ["shame-route-slots-of-day-v1", date, mode ?? "all", schools];
  const flightKey = key.join("|");
  const pending = slotsInFlight.get(flightKey);
  if (pending) return pending;
  const run = cachedForDay(
    async (classified) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipeline: any[] = [
        {
          $match: {
            // The pad reaches the tail of a run that started before 4am; the
            // equality keeps only the readings stamped to this day.
            scheduledAt: scheduledAtWindow(padScanRange(nzServiceDayRange(date))),
            serviceDate: date,
            ...realDeviationMatchFor(classified),
          },
        },
        // One row per run, so an hour is bucketed by the run's start rather than
        // by each stop time.
        {
          $group: {
            _id: { routeId: "$routeId", tripId: "$tripId" },
            trip_start: { $min: "$scheduledAt" },
            events: { $sum: 1 },
            avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
          },
        },
        { $addFields: { hour: { $hour: { date: "$trip_start", timezone: NZ_TZ } } } },
        {
          $group: {
            _id: { hour: "$hour", routeId: "$_id.routeId" },
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
      const schoolStage = schoolRouteMatch(schools);
      if (schoolStage) pipeline.push(schoolStage);

      pipeline.push(
        // Worst-first so $first picks the most off-schedule route per hour.
        { $sort: { avg_abs_delay_sec: -1 } },
        {
          $group: {
            _id: "$_id.hour",
            worstRouteId: { $first: "$_id.routeId" },
            slotDelay: { $first: "$avg_abs_delay_sec" },
          },
        },
        // Each route's hours, and its highest single-slot delay for worst-of-day.
        {
          $group: {
            _id: "$worstRouteId",
            hourCount: { $sum: 1 },
            maxSlotDelay: { $max: "$slotDelay" },
          },
        },
        { $sort: { maxSlotDelay: -1 } },
      );

      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: pipeline as never,
          cursor: { batchSize: 1_000 },
        }),
      )) as unknown as { cursor: { firstBatch: { _id: string; hourCount: number }[] } };

      // A plain array, since the cache stores JSON; the Map is built on read.
      const rows = res.cursor.firstBatch;
      return rows.length === 0
        ? null
        : {
            worstOfDayRouteId: rows[0]!._id,
            hours: rows.map((r) => [r._id, r.hourCount] as const),
          };
    },
    key,
    date,
    3600,
  ).then((day) =>
    day ? { worstOfDayRouteId: day.worstOfDayRouteId, hours: new Map(day.hours) } : null,
  );
  slotsInFlight.set(flightKey, run);
  void run.finally(() => slotsInFlight.delete(flightKey)).catch(() => {});
  return run;
}

/**
 * For each route in `routeIds`, compute its consecutive-day streak (ending
 * today) and the total number of hourly slots it was the worst route across
 * all previous streak days (today's hours are tracked separately by the caller).
 *
 * Walks back a day at a time from yesterday, reading each day's slots from
 * {@link shameSlotsOfDay}, and stops as soon as every route's streak has
 * broken: most streaks end within a day or two, so a request reads that many
 * days rather than the whole fortnight. A streak breaks when a route is absent
 * from a day's shame set or when a day has no data at all.
 *
 * Today counts as day 1 by definition (caller confirms all routeIds are on
 * today's shame list). Result caps at 15 (today + 14 prior days).
 * @param routeIds - Route IDs to check (from today's shame list).
 * @param currentRange - UTC half-open window for today's service day.
 * @param filter - Mode/school filter matching the active shame page view.
 * @param filter.mode - Restrict to this mode; null means all modes.
 * @param filter.schools - Which school services count (default leave them out).
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
  const { mode = null, schools = "exclude" } = filter;
  const result = new Map(
    routeIds.map((id) => [id, { count: 1, prevHours: 0, prevWorstOfDayDays: 0 }]),
  );
  // Routes whose streak is unbroken so far, and those still on a worst-of-day run.
  let open = new Set(routeIds);
  let worstRun = new Set(routeIds);
  // Step by date string, not fixed 24h of milliseconds: a millisecond step
  // drifts an hour off the 4am boundary across a DST change and skips a day.
  let dayKey = shiftWeek(nzServiceDayString(currentRange.start), -1);
  for (let d = 0; d < STREAK_DAYS && open.size > 0; d++) {
    const day = await shameSlotsOfDay(dayKey, mode, schools);
    if (!day) break;
    open = new Set([...open].filter((id) => day.hours.has(id)));
    worstRun = new Set([...worstRun].filter((id) => open.has(id) && day.worstOfDayRouteId === id));
    for (const id of open) {
      const r = result.get(id)!;
      r.count++;
      r.prevHours += day.hours.get(id)!;
      if (worstRun.has(id)) r.prevWorstOfDayDays++;
    }
    dayKey = shiftWeek(dayKey, -1);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addFieldsStage: Record<string, any>,
  tripHours: number[] | null = null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any[] = [
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
 * @param filter.schools - Which school services count (default leave them out).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The period's worst route and the per-hour worst list.
 */
export async function getShameRouteOfDay(
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
export async function getShameRoutesInHours(
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
                route_id: "$_id.routeId",
                short_name: "$route.shortName",
                long_name: "$route.longName",
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
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: pipeline as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as {
        cursor: { firstBatch: { total: number; rows: Omit<ShameRouteRaw, "hour">[] }[] };
      };
      const doc = res.cursor.firstBatch[0];
      return {
        total: doc?.total ?? 0,
        rows: (doc?.rows ?? []).map((r) => ({
          hour: hours.from,
          route_id: r.route_id,
          short_name: r.short_name ?? null,
          long_name: r.long_name ?? "",
          mode: r.mode ?? "BUS",
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
 * `(routeId, serviceDay)`. Mirrors {@link getShameRouteOfDay} but for the week
 * view. Cached at the supplied revalidate rate.
 * @param range - The week (or multi-day) window.
 * @param filter - Mode/school filters.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.schools - Which school services count (default leave them out).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The period's worst route and the per-day worst list, earliest day first.
 */
export async function getShameRouteOfWeek(
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
        cachedWorstRoutesOfDay(date, mode, schools, revalidate),
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
 * @param schools - Which school services count (default leave them out).
 * @param classified - Whether the day has been through the ghost pass.
 * @returns The per-service-day worst routes.
 */
async function worstRoutesForRange(
  range: DateRange,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
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
