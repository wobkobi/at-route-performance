// src/lib/data/shame-trips.ts
// The worst runs: the hourly shame board, its per-day week form and the day cache.
import { cachedForDay, cachedForRange, scheduledAtWindow, toIso } from "@/lib/data/cache";
import { SCHOOL_BUS_REGEX, type ShameFilter } from "@/lib/data/shame-filter";
import { prisma, runCommand } from "@/lib/db";
import { realDeviationMatchFor } from "@/lib/deviation";
import {
  type DateRange,
  NZ_TZ,
  SERVICE_START_HOUR,
  nzServiceDayRange,
  padScanRange,
  serviceDatesInRange,
} from "@/lib/time";
import type { ShameOfDay, ShameOfWeek, ShameTrip } from "@/types/dashboard";

/**
 * The cached worst runs for one service day. Key and TTL live here so the week
 * and month boards and the cache pre-warm route hit the same Data Cache entries.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param mode - Route mode filter (null = every mode).
 * @param includeSchool - Whether school services are included.
 * @param revalidate - TTL for the live day, in seconds.
 * @returns The day's worst runs.
 */
export function cachedWorstTripsOfDay(
  date: string,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  revalidate: number,
): Promise<ShameTrip[]> {
  return cachedForDay(
    (classified) => worstTripsForRange(nzServiceDayRange(date), mode, includeSchool, classified),
    ["shame-trip-worst-of-day", date, mode ?? "all", includeSchool ? "school" : "no-school"],
    date,
    revalidate,
  );
}

/** Fewest stops a run must have to qualify for the Shame board (drops flukes). */
export const SHAME_MIN_STOPS = 5;

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
  return cachedForRange(
    async (classified) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipeline: any[] = [
        {
          $match: {
            scheduledAt: scheduledAtWindow(padScanRange(range)),
            serviceDate: { $in: serviceDatesInRange(range) },
            ...realDeviationMatchFor(classified),
          },
        },
        // One row per run, with its off-schedule magnitude and owning route.
        {
          $group: {
            _id: "$tripId",
            route_id: { $first: "$routeId" },
            scheduled_start: { $min: "$scheduledAt" },
            _stops: { $addToSet: "$stopId" },
            avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
            avg_delay_sec: { $avg: "$deviationSec" },
            worst_delay_sec: { $max: "$deviationSec" },
          },
        },
        // Distinct stops with a real reading; rows would double-count a stop
        // that carries both a real arrival and a re-report.
        { $addFields: { stops: { $size: "$_stops" } } },
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
            hour: { $hour: { date: "$scheduled_start", timezone: NZ_TZ } },
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
      // Service-day order: 4am is first, post-midnight runs (12am-3am) are last.
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
    range,
    revalidate,
  );
}

/**
 * Build the shared part of the shame aggregation pipeline: match by date range,
 * group to one row per trip, filter by min stops, join Route + TripMeta, then
 * apply mode/school filters. The caller appends the final hour or service-day
 * grouping.
 * @param range - The window to query.
 * @param mode - Route mode filter (null = all).
 * @param includeSchool - Whether to include school services.
 * @param classified - Whether every day in the window has been through the ghost pass.
 * @returns The partial aggregation pipeline array.
 */
function shamePipelineBase(
  range: DateRange,
  mode: string | null,
  includeSchool: boolean,
  classified: boolean,
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
    {
      $group: {
        _id: "$tripId",
        route_id: { $first: "$routeId" },
        scheduled_start: { $min: "$scheduledAt" },
        // $min, not $first: $first is order-dependent without a preceding
        // $sort, so a run whose readings disagreed would bucket at random.
        service_date: { $min: "$serviceDate" },
        _stops: { $addToSet: "$stopId" },
        avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
        avg_delay_sec: { $avg: "$deviationSec" },
        worst_delay_sec: { $max: "$deviationSec" },
      },
    },
    // Distinct stops with a real reading; rows would double-count a stop
    // that carries both a real arrival and a re-report.
    { $addFields: { stops: { $size: "$_stops" } } },
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
 * {@link getShameOfDay} but groups by service day instead of hour, bucketing
 * each run by the service date ingest stamped on it. Cached at the supplied revalidate rate.
 * @param range - The week (or multi-day) window.
 * @param filter - Mode/school filters mirroring the home page.
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
  // Resolve each service day independently (cached per day) and combine, so a
  // busy live day never forces one heavy 7-day aggregation. This also makes the
  // per-day worst the day's actual worst run (AT reuses tripIds across days, so a
  // single week-wide grouping would otherwise collapse a trip's daily runs).
  const days = (
    await Promise.all(
      serviceDatesInRange(range).map((date) =>
        cachedWorstTripsOfDay(date, mode, includeSchool, revalidate),
      ),
    )
  ).flat();
  days.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const worst = days.reduce<ShameTrip | null>(
    (w, d) => (w == null || d.avg_abs_delay_sec > w.avg_abs_delay_sec ? d : w),
    null,
  );
  return { worst, days };
}

/**
 * The worst run of each service day within a range (one row per day with data).
 * Used per-day by {@link getShameOfWeek}; left uncached so the caller owns the
 * per-day cache key.
 * @param range - The window to aggregate (typically a single service day).
 * @param mode - Route mode filter (null = all).
 * @param includeSchool - Whether to include school services.
 * @param classified - Whether the day has been through the ghost pass.
 * @returns The per-service-day worst runs.
 */
async function worstTripsForRange(
  range: DateRange,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  classified: boolean,
): Promise<ShameTrip[]> {
  const pipeline = shamePipelineBase(range, mode, includeSchool, classified);
  pipeline.push(
    {
      // The day each run belongs to, as ingest stamped it, so a post-midnight
      // run lands under the day it started rather than the day it ended.
      $addFields: { serviceDay: "$service_date" },
    },
    // Worst run per service day via a bounded per-group $top (one row per day)
    // instead of a global blocking $sort, which can exceed the cluster's 32MB
    // in-memory sort limit (the tier forbids disk spill).
    {
      $group: {
        _id: "$serviceDay",
        worst: {
          $top: {
            sortBy: { avg_abs_delay_sec: -1 },
            output: {
              trip_id: { $toString: "$_id" },
              route_id: "$route_id",
              short_name: "$route.shortName",
              long_name: "$route.longName",
              mode: "$route.mode",
              colour: "$route.colour",
              scheduled_start: "$scheduled_start",
              stops: "$stops",
              avg_abs_delay_sec: "$avg_abs_delay_sec",
              avg_delay_sec: "$avg_delay_sec",
              worst_delay_sec: "$worst_delay_sec",
              headsign: "$meta.headsign",
            },
          },
        },
      },
    },
    {
      $project: {
        _id: 1,
        trip_id: "$worst.trip_id",
        route_id: "$worst.route_id",
        short_name: "$worst.short_name",
        long_name: "$worst.long_name",
        mode: "$worst.mode",
        colour: "$worst.colour",
        scheduled_start: "$worst.scheduled_start",
        stops: "$worst.stops",
        avg_abs_delay_sec: { $round: ["$worst.avg_abs_delay_sec", 1] },
        avg_delay_sec: { $round: ["$worst.avg_delay_sec", 1] },
        worst_delay_sec: "$worst.worst_delay_sec",
        headsign: "$worst.headsign",
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
    cursor: { firstBatch: (Omit<ShameTripRaw, "hour"> & { _id: string })[] };
  };

  return res.cursor.firstBatch.map((t) => ({
    hour: 0,
    date: t._id,
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
}
