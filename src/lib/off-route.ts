// src/lib/off-route.ts
// Spotting a vehicle away from its own trip's road path. AT publishes planned
// detours as service alerts, but an alert says what was announced for a route,
// often for longer than the detour runs, and nothing at all for a crash or a
// driver's own diversion. The vehicle feed says where each bus actually is, so
// the realtime ingest measures every in-progress vehicle against the GTFS shape
// of the trip it is running and keeps the readings well off it. Most such
// readings are not detours - a bus driving on to its next run or parked at a
// depot stays signed onto the trip it finished - so a trip counts as having left
// its route only when two readings fall between arrivals it recorded before and
// after (see confirmedDetour).

import type { AtTripUpdates } from "@/lib/at";

/**
 * Metres from the trip's road path before a reading counts. The stored shapes are
 * simplified to within 4 m and GPS drifts by tens of metres, but a bus at a city
 * terminus or layover routinely reads 150-200 m off its path, while a detour
 * round a closed street (West End Road, September 2026) read over 400 m; 200 m
 * keeps the first out and the second in.
 */
export const OFF_ROUTE_M = 200;

/** Off-route readings a trip needs before it counts as having left its route. */
export const MIN_SIGHTINGS = 2;

/** Oldest vehicle position (seconds) worth measuring; the feed keeps silent vehicles for minutes. */
export const MAX_POSITION_AGE_SEC = 180;

/**
 * Oldest a trip's next-stop time may be (seconds) for the trip to count as under
 * way. AT keeps a finished trip in the feed, pointing at its last stop, while the
 * vehicle drives to its next run or parks: at one midday snapshot vehicles more
 * than 200 m off their path had a median next-stop time 14 minutes past, those
 * on it 1 minute, and nine in ten on it were within 8 minutes.
 */
export const MAX_STOP_UPDATE_AGE_SEC = 600;

/** Metres per degree of latitude (good enough locally). */
const M_PER_DEG = 111_320;

/**
 * Metres from a point to the nearest point on a path, on a local flat projection
 * around the point (ample at city scale).
 * @param lat - The point's latitude.
 * @param lon - The point's longitude.
 * @param path - The path as `[lon, lat]` pairs, the stored shape order.
 * @returns The distance in metres, or Infinity for an empty path.
 */
export function distanceToPathM(
  lat: number,
  lon: number,
  path: ReadonlyArray<readonly [number, number]>,
): number {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  /**
   * Project a path point to metres east and north of the reading.
   * @param p - The `[lon, lat]` point.
   * @returns `[x, y]` in metres.
   */
  const project = (p: readonly [number, number]): [number, number] => [
    (p[0] - lon) * M_PER_DEG * cosLat,
    (p[1] - lat) * M_PER_DEG,
  ];
  const first = path[0];
  if (first === undefined) return Infinity;
  let [ax, ay] = project(first);
  let best = Math.hypot(ax, ay);
  for (let i = 1; i < path.length; i++) {
    const point = path[i];
    if (point === undefined) continue;
    const [bx, by] = project(point);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Closest point on segment a-b to the origin (the reading), clamped to the segment.
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    ax = bx;
    ay = by;
  }
  return best;
}

/**
 * The shape id prefix an AT trip id carries. AT's ids read
 * `{block}-{service}-{startSeconds}-{variant}-{hash}` for trips and
 * `{block}-{service}-{hash}` for shapes, and a trip's shape shares its first two
 * segments (12 of 12 sampled; at most three shapes share one prefix).
 * @param tripId - AT trip id.
 * @returns The `{block}-{service}` prefix, or null for another id shape.
 */
export function shapePrefix(tripId: string): string | null {
  const [block, service] = tripId.split("-");
  return block && service ? `${block}-${service}` : null;
}

/**
 * Trips part-way through their run: the feed's next stop is past the first, so
 * the vehicle has left its origin (a vehicle signed onto a trip before
 * departure can sit anywhere, a depot included), and that stop's time is recent
 * (see {@link MAX_STOP_UPDATE_AGE_SEC}). Cancelled trips are left out.
 * @param feed - The trip updates feed.
 * @param now - The current time, epoch seconds.
 * @returns The in-progress trip ids.
 */
export function inProgressTrips(feed: AtTripUpdates, now: number): Set<string> {
  const out = new Set<string>();
  for (const e of feed.entity) {
    const tu = e.trip_update;
    if (!tu?.trip.trip_id || tu.trip.schedule_relationship === 3) continue;
    const stus = Array.isArray(tu.stop_time_update)
      ? tu.stop_time_update
      : tu.stop_time_update
        ? [tu.stop_time_update]
        : [];
    const live = stus.some((s) => {
      const time = s.arrival?.time ?? s.departure?.time;
      return (
        (s.stop_sequence ?? 0) >= 2 &&
        typeof time === "number" &&
        now - time <= MAX_STOP_UPDATE_AGE_SEC
      );
    });
    if (live) out.add(tu.trip.trip_id);
  }
  return out;
}

/** One vehicle position on a trip. */
export interface VehicleReading {
  tripId: string;
  routeId: string;
  vehicleId: string;
  lat: number;
  lon: number;
  /** Position timestamp, epoch seconds. */
  timestamp: number;
}

/** A reading well off its trip's road path. */
export interface OffRouteReading extends VehicleReading {
  /** Metres from the nearest candidate path. */
  distanceM: number;
}

/**
 * The readings well off their trip's road path. A trip with more than one
 * candidate path (the shapes sharing its prefix, before the exact shape id is
 * known) is measured against the nearest, so it only counts when off all of them.
 * @param readings - Vehicle positions on trips.
 * @param inProgress - Trip ids part-way through their run (see {@link inProgressTrips}).
 * @param pathsFor - The candidate road paths for a trip, `[lon, lat]` pairs; empty when unknown.
 * @param now - The current time, epoch seconds.
 * @returns The off-route readings.
 */
export function findOffRoute(
  readings: readonly VehicleReading[],
  inProgress: ReadonlySet<string>,
  pathsFor: (tripId: string) => ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  now: number,
): OffRouteReading[] {
  const out: OffRouteReading[] = [];
  for (const r of readings) {
    if (!inProgress.has(r.tripId) || now - r.timestamp > MAX_POSITION_AGE_SEC) continue;
    const paths = pathsFor(r.tripId);
    if (paths.length === 0) continue;
    const distanceM = Math.min(...paths.map((p) => distanceToPathM(r.lat, r.lon, p)));
    if (distanceM > OFF_ROUTE_M) out.push({ ...r, distanceM: Math.round(distanceM) });
  }
  return out;
}

/**
 * Arrivals a trip needs after an off-route reading for the reading to count.
 * The feed leaves one predicted next-stop arrival behind a trip that stops
 * reporting (see lib/cancellation.ts), so a second one shows it carried on.
 */
export const MIN_ARRIVALS_AFTER = 2;

/** A stored off-route reading. */
export interface Sighting {
  /** ISO instant of the vehicle position. */
  at: string;
  lat: number;
  lon: number;
  distanceM: number;
}

/**
 * The readings that show a trip left its route mid-run: each must fall after the
 * trip's first recorded arrival and before at least {@link MIN_ARRIVALS_AFTER}
 * more, so a bus still driving to its first stop, or driving on to its next run
 * while signed onto a finished trip, never counts. The trip counts only with at
 * least {@link MIN_SIGHTINGS} such readings.
 * @param sightings - The trip's stored off-route readings on one service day.
 * @param arrivals - ISO instants of the trip's real arrivals that day, any order.
 * @returns The confirming readings in time order, or empty when the trip stayed on its route.
 */
export function confirmedDetour(
  sightings: readonly Sighting[],
  arrivals: readonly string[],
): Sighting[] {
  const times = arrivals.map((a) => Date.parse(a)).sort((a, b) => a - b);
  const first = times[0];
  if (first === undefined) return [];
  const kept = [...sightings]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .filter((s) => {
      const at = Date.parse(s.at);
      return at > first && times.filter((t) => t > at).length >= MIN_ARRIVALS_AFTER;
    });
  return kept.length >= MIN_SIGHTINGS ? kept : [];
}
