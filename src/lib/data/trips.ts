// src/lib/data/trips.ts
// Runs of a route: the day's worst trips board, one trip's timeline and its schedule.
import { fetchAll, getJson } from "@/lib/at-static";
import { cachedForRange, scheduledAtWindow, toIso } from "@/lib/data/cache";
import { routeIdsForSlug } from "@/lib/data/routes";
import { prisma, runCommand } from "@/lib/db";
import {
  isGhostDeviation,
  medianDeviation,
  realDeviationExprFor,
  realDeviationMatchFor,
} from "@/lib/deviation";
import { unstable_cache } from "@/lib/mem-cache";
import {
  type StationRow,
  stationId,
  stationName,
  stationPartsOf,
  stationProjection,
} from "@/lib/station";
import { type DateRange, NZ_TZ, nzServiceDayRange } from "@/lib/time";
import type { PerTripStat, TripStop, TripTimeline } from "@/types/api";

/** Parameters for {@link getWorstTripsOfDay}. */
export interface WorstTripsParams {
  routeId: string;
  range: DateRange;
  thresholdSec: number;
  limit?: number;
  /** How to order the runs (default "off" = most off-schedule). */
  sort?: TripSort;
}

/** Ordering for {@link getWorstTripsOfDay}. */
export type TripSort = "off" | "late" | "early" | "departure";

/** Mongo `$sort` stage for each trip ordering. */
const TRIP_SORTS: Record<TripSort, Record<string, 1 | -1>> = {
  off: { avg_abs_delay_sec: -1 },
  late: { avg_delay_sec: -1 },
  early: { avg_delay_sec: 1 },
  departure: { scheduled_start: 1 },
};

/** Raw worst-trips row before the `scheduled_start` date is normalised. */
interface WorstTripRaw extends Omit<PerTripStat, "scheduled_start"> {
  scheduled_start: { $date: string } | string;
}

/**
 * List each run (trip) of a route on a day, ordered by `sort` (default most
 * off-schedule by average absolute deviation). The signed average is kept so the
 * board can still show late/early direction. Cached briefly.
 * @param p - Route, day window, on-time threshold, optional row limit and sort.
 * @returns Per-trip rows ordered by `sort` (up to `limit`, default 50).
 */
export async function getWorstTripsOfDay(p: WorstTripsParams): Promise<PerTripStat[]> {
  const limit = p.limit ?? 50;
  const sort = p.sort ?? "off";
  return cachedForRange(
    async (classified) => {
      const routeIds = await routeIdsForSlug(p.routeId);
      const real = realDeviationExprFor(classified);
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            {
              $match: {
                routeId: { $in: routeIds },
                scheduledAt: scheduledAtWindow(p.range),
                // No deviation filter here: every trip that had any event is
                // counted so the total reflects real runs, not just those within
                // the noise-free window.
              },
            },
            // Sort by time first so $first/$last within the group give the
            // chronological first/last stop, not an arbitrary document order.
            { $sort: { tripId: 1, scheduledAt: 1 } },
            {
              $group: {
                _id: "$tripId",
                scheduled_start: { $min: "$scheduledAt" },
                first_stop_id: { $first: "$stopId" },
                // Real readings only: a ghost re-report contributes null to each
                // list and is dropped below, so the stop count, the vehicle and
                // the stats all describe the run itself. A ghost comes from a
                // different vehicle, so its id would name the wrong bus, and it
                // repeats a stop the run already served, so counting rows would
                // overstate the stops.
                _delays: { $push: { $cond: [real, "$deviationSec", null] } },
                _stops: { $addToSet: { $cond: [real, "$stopId", null] } },
                _vehicles: { $push: { $cond: [real, { $ifNull: ["$vehicleId", null] }, null] } },
              },
            },
            {
              $addFields: {
                _ok: { $filter: { input: "$_delays", as: "d", cond: { $ne: ["$$d", null] } } },
                stops: {
                  $size: { $filter: { input: "$_stops", as: "s", cond: { $ne: ["$$s", null] } } },
                },
                // The chronologically first real reading names the vehicle.
                vehicle_id: {
                  $first: {
                    $filter: { input: "$_vehicles", as: "v", cond: { $ne: ["$$v", null] } },
                  },
                },
              },
            },
            {
              $addFields: {
                avg_delay_sec: { $avg: "$_ok" },
                avg_abs_delay_sec: {
                  $avg: { $map: { input: "$_ok", as: "d", in: { $abs: "$$d" } } },
                },
                worst_delay_sec: { $max: "$_ok" },
              },
            },
            // AT issues several trip_ids for one physical run, so collapse runs that
            // share the same Auckland-local start minute and stop count into one
            // (keeping the most off-schedule). Done before the metric sort + limit so
            // the board and the Trips count reflect real runs.
            {
              $addFields: {
                _minute: {
                  $dateToString: {
                    date: "$scheduled_start",
                    format: "%Y-%m-%dT%H:%M",
                    timezone: NZ_TZ,
                  },
                },
              },
            },
            { $sort: { _minute: 1, stops: -1, avg_abs_delay_sec: -1 } },
            { $group: { _id: { m: "$_minute", s: "$stops" }, doc: { $first: "$$ROOT" } } },
            { $replaceRoot: { newRoot: "$doc" } },
            { $lookup: { from: "tripMeta", localField: "_id", foreignField: "_id", as: "meta" } },
            { $unwind: { path: "$meta", preserveNullAndEmptyArrays: true } },
            { $sort: TRIP_SORTS[sort] },
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
                headsign: { $ifNull: ["$meta.headsign", null] },
                direction_id: { $ifNull: ["$meta.directionId", null] },
                first_stop_id: 1,
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: WorstTripRaw[] } };
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
      sort,
    ],
    p.range,
    300,
  );
}

/** Raw trip-timeline stop row before the `scheduled_at` date is normalised. */
interface TripStopRaw extends Omit<TripStop, "scheduled_at">, StationRow {
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
  // Cache the raw ISO string; reconstruct DateRange outside to avoid Date serialisation issues.
  const iso = await unstable_cache(
    async () => {
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            { $match: { tripId } },
            { $group: { _id: null, max: { $max: "$scheduledAt" } } },
          ] as never,
          cursor: { batchSize: 1 },
        }),
      )) as unknown as { cursor: { firstBatch: { max?: { $date: string } | string }[] } };
      const raw = res.cursor.firstBatch[0]?.max;
      return raw ? toIso(raw) : null;
    },
    ["latest-trip-day", tripId],
    { revalidate: 21600 },
  )();
  return iso ? nzServiceDayRange(new Date(iso)) : null;
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
  return cachedForRange(
    async (classified) => {
      const routeIds = await routeIdsForSlug(routeId);
      const route = await prisma.route.findUnique({
        where: { id: routeIds[0] },
        select: { shortName: true, longName: true, mode: true, colour: true },
      });

      const match: Record<string, unknown> = { tripId, ...realDeviationMatchFor(classified) };
      if (day) {
        match.scheduledAt = {
          $gte: { $date: day.start.toISOString() },
          $lt: { $date: day.end.toISOString() },
        };
      }

      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
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
                lat: "$stop.lat",
                lon: "$stop.lon",
                scheduled_at: "$scheduledAt",
                deviation_sec: "$deviationSec",
                vehicle_id: "$vehicleId",
                ...stationProjection,
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: TripStopRaw[] } };

      // AT re-reports a trip_id against a later vehicle cycle, so a stop can carry
      // both its real arrival and a "ghost" reading ~1h off - and the ghosts can
      // even outnumber the real events. Collapse each station (and its platforms)
      // to the event nearest its own schedule (the real run), then drop anything
      // sitting a vehicle cycle off the run's own level rather than showing it
      // wildly late. Same rule the nightly pass applies (see lib/deviation.ts),
      // reapplied here because a timeline can be read before that pass has run.
      const bestByStop = new Map<string, TripStopRaw>();
      for (const r of res.cursor.firstBatch) {
        const id = stationId(r.stop_id, r.name, stationPartsOf(r));
        const cur = bestByStop.get(id);
        if (!cur || Math.abs(r.deviation_sec) < Math.abs(cur.deviation_sec)) bestByStop.set(id, r);
      }
      const chosen = [...bestByStop.values()].sort(
        (a, b) => +new Date(toIso(a.scheduled_at)) - +new Date(toIso(b.scheduled_at)),
      );
      const runMedian = medianDeviation(chosen.map((r) => r.deviation_sec)) ?? 0;

      const stops: TripStop[] = [];
      for (const r of chosen) {
        if (isGhostDeviation(r.deviation_sec, runMedian)) continue;
        stops.push({
          stop_id: stationId(r.stop_id, r.name, stationPartsOf(r)),
          name: stationName(r.name),
          lat: r.lat,
          lon: r.lon,
          scheduled_at: toIso(r.scheduled_at),
          deviation_sec: r.deviation_sec,
        });
      }
      return {
        trip_id: tripId,
        route: route
          ? {
              shortName: route.shortName,
              longName: route.longName,
              mode: route.mode,
              colour: route.colour,
            }
          : null,
        vehicle_id: res.cursor.firstBatch.find((r) => r.vehicle_id)?.vehicle_id ?? null,
        stops,
      };
    },
    ["trip-timeline", tripId, routeId, day?.start.toISOString() ?? "all"],
    // The "all" variant follows the trip's latest day and stays short-lived.
    day ?? null,
    300,
  );
}

/** One stop in a trip's GTFS scheduled stop sequence. */
export interface ScheduledStop {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  stop_sequence: number;
  /** GTFS departure time "HH:MM:SS"; hours may exceed 23 for post-midnight trips. */
  departure_time: string | null;
}

/**
 * Scheduled stop sequence for a trip from the AT GTFS static feed, joined with
 * stop names and coordinates from the database. Cached for a day - the schedule
 * does not change during a trip's service day. An AT failure throws out of the
 * cache rather than storing an empty schedule for the day; the trip page treats
 * it as no schedule for that request only.
 * @param tripId - AT GTFS trip id.
 * @returns Stops ordered by stop_sequence with display names and coordinates.
 */
export async function getTripScheduledStops(tripId: string): Promise<ScheduledStop[]> {
  interface RawStopTime {
    stop_id: string;
    stop_sequence: number;
    departure_time?: string | null;
  }
  return unstable_cache(
    async () => {
      const stoptimes = await fetchAll<RawStopTime>(
        `/trips/${encodeURIComponent(tripId)}/stoptimes`,
      );
      if (stoptimes.length === 0) return [];
      const ordered = stoptimes.slice().sort((a, b) => a.stop_sequence - b.stop_sequence);
      const stopIds = ordered.map((s) => s.stop_id);
      const stopDocs = await prisma.stop.findMany({
        where: { id: { in: stopIds } },
        select: {
          id: true,
          name: true,
          lat: true,
          lon: true,
          parentStation: true,
          platformCode: true,
        },
      });
      const stopById = new Map(stopDocs.map((s) => [s.id, s]));
      const out: ScheduledStop[] = [];
      for (const st of ordered) {
        const stop = stopById.get(st.stop_id);
        if (!stop) continue;
        out.push({
          stop_id: stationId(stop.id, stop.name, stop),
          name: stationName(stop.name),
          lat: stop.lat,
          lon: stop.lon,
          stop_sequence: st.stop_sequence,
          departure_time: st.departure_time ?? null,
        });
      }
      return out;
    },
    ["trip-scheduled-stops", tripId],
    { revalidate: 86_400 },
  )();
}

/**
 * The road path one trip drives, as `[lat, lon]` pairs for the map. AT's trip
 * record names its GTFS `shape_id`, and the shapes ingest stores that geometry
 * (simplified, in `[lon, lat]` order). Cached for a day like the schedule. A
 * trip AT no longer publishes (a 404 for an older feed version) or a shape the
 * ingest has not stored yet resolves to an empty path, so the caller can fall
 * back to joining the stops. Any other AT failure throws out of the cache, as
 * {@link getTripScheduledStops} does, so an outage is not pinned for the day.
 * @param tripId - AT GTFS trip id.
 * @returns The trip's road path, or an empty array when it cannot be resolved.
 */
export async function getTripShape(tripId: string): Promise<Array<[number, number]>> {
  return unstable_cache(
    async () => {
      const trip = await getJson<{ shape_id?: string | null }>(
        `/trips/${encodeURIComponent(tripId)}`,
      ).catch((err: unknown) => {
        if (err instanceof Error && err.message.startsWith("AT v3 404 ")) return null;
        throw err;
      });
      // A single-resource JSON:API response carries one object in `data`, not a list.
      const data = trip?.data as unknown as { attributes?: { shape_id?: string | null } } | null;
      const shapeId = data?.attributes?.shape_id;
      if (!shapeId) return [];
      const shape = await prisma.shape.findUnique({
        where: { id: shapeId },
        select: { points: true },
      });
      const points = (shape?.points ?? []) as unknown as [number, number][];
      return points.map(([lon, lat]): [number, number] => [lat, lon]);
    },
    ["trip-shape", tripId],
    { revalidate: 86_400 },
  )();
}
