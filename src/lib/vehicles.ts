// src/lib/vehicles.ts
import { fetchATTripUpdates, type TripUpdate } from "@/lib/at";
import { unstable_cache } from "next/cache";

/** A live vehicle position with its current schedule deviation (if known). */
export interface LiveVehicle {
  vehicleId: string;
  label: string | null;
  routeId: string;
  tripId: string | null;
  lat: number;
  lon: number;
  /** Signed deviation in seconds (negative early, positive late), or null. */
  delaySec: number | null;
  /** Compass heading in degrees (0 = north), when the feed reports it. */
  bearing: number | null;
  /** GTFS trip direction (0/1), when the feed reports it. */
  directionId: number | null;
}

/** Raw vehicle-locations entity shape (subset of AT's GTFS-RT JSON). */
interface VehicleEntity {
  vehicle?: {
    trip?: { trip_id?: string; route_id?: string; direction_id?: number | string };
    position?: { latitude?: number; longitude?: number; bearing?: number | string };
    vehicle?: { id?: string; label?: string };
  };
}

const DEFAULT_VEHICLES_URL = "https://api.at.govt.nz/realtime/legacy/vehiclelocations";

/**
 * Representative current delay for a trip: the deviation at its next known stop,
 * falling back to the trip-level delay.
 * @param tu - A trip update from the GTFS-RT feed.
 * @returns Signed seconds, or null when the feed carries no delay.
 */
function tripDelay(tu: TripUpdate): number | null {
  const stus = Array.isArray(tu.stop_time_update)
    ? tu.stop_time_update
    : tu.stop_time_update
      ? [tu.stop_time_update]
      : [];
  for (const stu of stus) {
    const d = stu.arrival?.delay ?? stu.departure?.delay;
    if (typeof d === "number") return d;
  }
  return typeof tu.delay === "number" ? tu.delay : null;
}

/**
 * Fetch AT's GTFS-RT vehicle-locations feed and join each vehicle to its trip's
 * current delay. Cached briefly so many viewers share one upstream call.
 * @returns Every live vehicle with a position.
 */
async function queryLiveVehicles(): Promise<LiveVehicle[]> {
  const [vehRes, tripUpdates] = await Promise.all([
    fetch(process.env.AT_VEHICLELOCATIONS_URL ?? DEFAULT_VEHICLES_URL, {
      headers: {
        "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY ?? "",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }),
    fetchATTripUpdates().catch(() => ({ entity: [] })),
  ]);

  if (!vehRes.ok) throw new Error(`AT vehicle locations ${vehRes.status}`);
  const raw = (await vehRes.json()) as {
    response?: { entity?: VehicleEntity[] };
    entity?: VehicleEntity[];
  };
  const root = raw.response ?? raw;
  const entities = root.entity ?? [];

  // trip_id > current delay, from the trip-updates feed.
  const delayByTrip = new Map<string, number>();
  for (const e of tripUpdates.entity) {
    const tu = e.trip_update;
    if (!tu?.trip?.trip_id) continue;
    const d = tripDelay(tu);
    if (d !== null) delayByTrip.set(tu.trip.trip_id, d);
  }

  const out: LiveVehicle[] = [];
  for (const e of entities) {
    const v = e.vehicle;
    const lat = v?.position?.latitude;
    const lon = v?.position?.longitude;
    const routeId = v?.trip?.route_id;
    const vehicleId = v?.vehicle?.id;
    if (!routeId || vehicleId == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const tripId = v?.trip?.trip_id ?? null;
    // Bearing and direction arrive as numbers or numeric strings depending on
    // the feed; coerce and keep only finite values.
    const bearingNum = Number(v?.position?.bearing);
    const dirNum = Number(v?.trip?.direction_id);
    out.push({
      vehicleId,
      label: v?.vehicle?.label ?? null,
      routeId,
      tripId,
      lat: lat as number,
      lon: lon as number,
      delaySec: tripId ? (delayByTrip.get(tripId) ?? null) : null,
      bearing: Number.isFinite(bearingNum) ? bearingNum : null,
      directionId: Number.isFinite(dirNum) ? dirNum : null,
    });
  }
  return out;
}

/**
 * Map each currently-tracked trip to its running vehicle (fleet label preferred,
 * else feed id), from the vehicle-locations feed. The realtime ingest tags
 * arrival rows with this so the trip boards can name the vehicle instead of
 * "unknown bus" - the tripupdates feed that ingest reads does not carry vehicle,
 * so this join (by trip_id, the same one the live map uses) is the source.
 * Uncached: the ingest wants the snapshot at its own moment.
 * @returns `trip_id` > vehicle label/id for every live vehicle on a trip.
 */
export async function fetchVehicleByTrip(): Promise<Map<string, string>> {
  const res = await fetch(process.env.AT_VEHICLELOCATIONS_URL ?? DEFAULT_VEHICLES_URL, {
    headers: {
      "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY ?? "",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`AT vehicle locations ${res.status}`);
  const raw = (await res.json()) as {
    response?: { entity?: VehicleEntity[] };
    entity?: VehicleEntity[];
  };
  const entities = (raw.response ?? raw).entity ?? [];
  const byTrip = new Map<string, string>();
  for (const e of entities) {
    const v = e.vehicle;
    const tripId = v?.trip?.trip_id;
    const vid = v?.vehicle?.label ?? v?.vehicle?.id;
    if (tripId && vid) byTrip.set(tripId, vid);
  }
  return byTrip;
}

/**
 * Cached snapshot of all live vehicles (60s TTL). The cache is shared across all
 * viewers and requests, so the upstream AT feed is hit at most once per window
 * regardless of how many route pages are open or how often they poll - keeping
 * well within AT's 35,000 calls/week quota. Filter by route at the call site.
 * @returns Live vehicles across the network.
 */
export async function getLiveVehicles(): Promise<LiveVehicle[]> {
  return unstable_cache(queryLiveVehicles, ["live-vehicles"], { revalidate: 60 })();
}
