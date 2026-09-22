// src/lib/vehicles.ts
// Fetch live vehicle positions from AT's GTFS-RT vehicle-locations
// feed and join each to its trip's current schedule deviation from the trip-
// updates feed, yielding delay-aware LiveVehicle markers for the map.
// Cached briefly so map polling does not hammer the AT API.

import { fetchATTripUpdates, type TripUpdate } from "@/lib/at";
import { unstable_cache } from "@/lib/mem-cache";
import type { VehicleReading } from "@/lib/off-route";
import { trainCars, type TrainUnit } from "@/lib/train-consist";
import { parseBearing } from "@/lib/vehicle-status";

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
  /** Compass heading in degrees (0 = north), or null when the feed names none. */
  bearing: number | null;
  /** GTFS trip direction (0/1), when the feed reports it. */
  directionId: number | null;
  /** Carriages (3, 6 or 9) for a train, null for anything else. */
  cars: number | null;
  /** Number plate; the feed sends one for buses only. */
  plate: string | null;
  /** GTFS-RT occupancy status (0 empty to 6 not taking passengers), when sent. */
  occupancy: number | null;
  /** Speed in km/h, when sent. */
  speedKmh: number | null;
  /** Odometer in km; trains only. */
  odometerKm: number | null;
  /** When the position was taken, epoch seconds. */
  seenAt: number | null;
}

/** Raw vehicle-locations entity shape (subset of AT's GTFS-RT JSON). */
interface VehicleEntity {
  vehicle?: {
    trip?: { trip_id?: string; route_id?: string; direction_id?: number | string };
    position?: {
      latitude?: number;
      longitude?: number;
      bearing?: number | string;
      /** Metres per second. */
      speed?: number | string;
      /** Metres. */
      odometer?: number | string;
    };
    vehicle?: { id?: string; label?: string; license_plate?: string };
    /** Position timestamp, epoch seconds (a number or numeric string). */
    timestamp?: number | string;
    occupancy_status?: number | string;
  };
}

/**
 * A fleet label as AT sends it, which pads train labels to a fixed width
 * ("AMP        1020").
 * @param raw - The raw label.
 * @returns The label with its runs of spaces collapsed, or null when blank.
 */
function cleanLabel(raw: string | undefined): string | null {
  return raw?.replace(/\s+/g, " ").trim() || null;
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

  const cars = consistCars(entities);
  const out: LiveVehicle[] = [];
  for (const e of entities) {
    const v = e.vehicle;
    const lat = v?.position?.latitude;
    const lon = v?.position?.longitude;
    const routeId = v?.trip?.route_id;
    const vehicleId = v?.vehicle?.id;
    if (!routeId || vehicleId == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const tripId = v?.trip?.trip_id ?? null;
    // Direction arrives as a number or a numeric string depending on the feed;
    // coerce and keep only finite values. The bearing has its own reading.
    const dirNum = Number(v?.trip?.direction_id);
    const speed = feedNumber(v?.position?.speed);
    const odometer = feedNumber(v?.position?.odometer);
    out.push({
      vehicleId,
      label: cleanLabel(v?.vehicle?.label),
      routeId,
      tripId,
      lat: lat as number,
      lon: lon as number,
      delaySec: tripId ? (delayByTrip.get(tripId) ?? null) : null,
      bearing: parseBearing(v?.position?.bearing),
      directionId: Number.isFinite(dirNum) ? dirNum : null,
      cars: cars.get(vehicleId) ?? null,
      plate: v?.vehicle?.license_plate?.trim() || null,
      occupancy: feedNumber(v?.occupancy_status),
      speedKmh: speed != null ? Math.round(speed * 3.6) : null,
      odometerKm: odometer != null && odometer > 0 ? Math.round(odometer / 1000) : null,
      seenAt: feedNumber(v?.timestamp),
    });
  }
  return out;
}

/** AT's electric train units carry fleet labels starting "AM" (the AM class). */
const TRAIN_LABEL = /^AM/;

/**
 * A number from the feed, which sends some fields as numeric strings.
 * @param raw - The raw field.
 * @returns The finite number, or null.
 */
function feedNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Carriages per train in service, keyed by the vehicle id of the unit carrying
 * the trip. See {@link trainCars} for how coupled units are matched.
 * @param entities - Every entity in one read of the vehicle feed.
 * @returns Vehicle id > carriages, for trains only.
 */
function consistCars(entities: VehicleEntity[]): Map<string, number> {
  const leads: TrainUnit[] = [];
  const free: TrainUnit[] = [];
  for (const e of entities) {
    const v = e.vehicle;
    const id = v?.vehicle?.id;
    const lat = v?.position?.latitude;
    const lon = v?.position?.longitude;
    if (id == null || !TRAIN_LABEL.test(v?.vehicle?.label ?? "")) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const unit: TrainUnit = {
      id,
      lat: lat as number,
      lon: lon as number,
      speed: feedNumber(v?.position?.speed),
      bearing: parseBearing(v?.position?.bearing),
      timestamp: feedNumber(v?.timestamp),
    };
    (v?.trip?.trip_id ? leads : free).push(unit);
  }
  return trainCars(leads, free);
}

/** What the realtime ingest takes from one read of the vehicle-locations feed. */
export interface VehicleSnapshot {
  /** `trip_id` > vehicle label (fleet label preferred, else feed id) for every vehicle on a trip. */
  byTrip: Map<string, string>;
  /** `trip_id` > carriages, for every train in service. */
  carsByTrip: Map<string, number>;
  /** Every vehicle on a trip with a position, for the off-route check. */
  readings: VehicleReading[];
  /** Every vehicle the feed names, on a trip or not, for the fleet register. */
  fleet: FleetEntry[];
}

/** One vehicle's descriptor from the feed, as the fleet register stores it. */
export interface FleetEntry {
  id: string;
  label: string | null;
  plate: string | null;
}

/**
 * Read the vehicle-locations feed once for the realtime ingest. The trip map
 * tags arrival rows so the trip boards can name the vehicle instead of "unknown
 * bus" - the tripupdates feed that ingest reads does not carry vehicle, so this
 * join (by trip_id, the same one the live map uses) is the source. The readings
 * feed the off-route check (see lib/off-route.ts). Uncached: the ingest wants
 * the snapshot at its own moment.
 * @returns The trip map and the positioned readings.
 */
export async function fetchVehicleSnapshot(): Promise<VehicleSnapshot> {
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
  const carsByTrip = new Map<string, number>();
  const cars = consistCars(entities);
  const readings: VehicleReading[] = [];
  const fleet: FleetEntry[] = [];
  for (const e of entities) {
    const v = e.vehicle;
    const id = v?.vehicle?.id;
    if (id) {
      fleet.push({
        id,
        label: cleanLabel(v?.vehicle?.label),
        plate: v?.vehicle?.license_plate?.trim() || null,
      });
    }
    const tripId = v?.trip?.trip_id;
    const vid = v?.vehicle?.label ?? v?.vehicle?.id;
    if (!tripId || !vid) continue;
    byTrip.set(tripId, vid);
    const n = v?.vehicle?.id != null ? cars.get(v.vehicle.id) : undefined;
    if (n != null) carsByTrip.set(tripId, n);
    const lat = v?.position?.latitude;
    const lon = v?.position?.longitude;
    const timestamp = Number(v?.timestamp);
    const routeId = v?.trip?.route_id;
    if (routeId && Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(timestamp)) {
      readings.push({
        tripId,
        routeId,
        vehicleId: vid,
        lat: lat as number,
        lon: lon as number,
        timestamp,
      });
    }
  }
  return { byTrip, carsByTrip, readings, fleet };
}

/**
 * Cached snapshot of all live vehicles (120s TTL). The cache is shared across
 * all viewers and requests so the upstream AT feed is hit at most once per
 * 120s window regardless of concurrent viewers - capping page-render vehicle
 * calls at ~10,000/week. Combined with the realtime ingest's own uncached
 * calls (10,080/week fixed) and service-alert calls (2,016/week), total stays
 * comfortably under AT's 35,000 calls/week quota. Filter by route at the call
 * site.
 * @returns Live vehicles across the network.
 */
export async function getLiveVehicles(): Promise<LiveVehicle[]> {
  return unstable_cache(queryLiveVehicles, ["live-vehicles-v3"], { revalidate: 120 })();
}

/**
 * Live vehicles by feed id. A failed feed read gives an empty map, so a page
 * shows nothing live rather than an error.
 * @returns Vehicle id > live vehicle.
 */
export async function getLiveVehicleMap(): Promise<Map<string, LiveVehicle>> {
  const list = await getLiveVehicles().catch(() => []);
  return new Map(list.map((v) => [v.vehicleId, v]));
}
