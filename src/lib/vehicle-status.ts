// src/lib/vehicle-status.ts
// What a live vehicle marker says about its delay and heading. The ring colour,
// the floating label and the popup all read one delay verdict, so a bus cannot
// show a late ring beside a popup that says it is on time.
import { formatDelay } from "@/lib/format";
import { distanceToPathM } from "@/lib/off-route";
import { delayBand, type DelayBand } from "@/lib/on-time";
import type { LiveVehicle } from "@/lib/vehicles";

/** A vehicle's delay verdict: its band on the mode's on-time window, or unknown. */
export interface VehicleStatus {
  /** The band the ring is coloured by; unknown when the feed carries no delay. */
  band: DelayBand | "unknown";
  /** The floating label, shown only outside the on-time window. */
  label: string | null;
  /** The popup's delay line. */
  detail: string;
}

/**
 * Classify a live vehicle's delay on its mode's on-time window.
 * @param delaySec - The feed's signed delay (negative early), or null.
 * @param mode - The route's mode, which sets the early tolerance.
 * @returns The band, the label and the popup line.
 */
export function vehicleStatus(delaySec: number | null, mode: string): VehicleStatus {
  if (delaySec == null || !Number.isFinite(delaySec)) {
    return { band: "unknown", label: null, detail: "No live delay" };
  }
  const band = delayBand(delaySec, mode);
  // A zero threshold always names the distance, so "3m late" inside the window
  // still says how late, and the band word says how that counts.
  const distance = formatDelay(delaySec, { thresholdSec: 0 });
  if (band !== "ontime") return { band, label: distance, detail: distance };
  return {
    band,
    label: null,
    detail: distance === "on time" ? "On time" : `${distance}, inside the on-time window`,
  };
}

/**
 * A feed bearing as a heading the map can draw, or null when it names none.
 * AT sends 0 for a stationary vehicle or one with no heading, so 0 reads as
 * unknown: drawing it would show every parked bus heading due north. A genuine
 * heading of exactly 0.0 is rare enough that losing its arrow costs less than the
 * false ones.
 * @param raw - The feed's bearing, a number or a numeric string.
 * @returns Degrees clockwise from north in [0, 360), or null.
 */
export function parseBearing(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return null;
  return ((n % 360) + 360) % 360;
}

/**
 * How far a vehicle may sit from the route's drawn line and still be shown: wide
 * enough to keep a bus on a detour, narrow enough to leave out one parked at a
 * depot with its last trip still attached.
 */
export const VEHICLE_MAX_OFF_LINE_M = 2000;

/** What a map shows, for choosing which of a route's vehicles belong on it. */
export interface VehicleMapScope {
  /** A trip map shows that trip's vehicle and nothing else. */
  tripId?: string;
  /** The directions a direction-filtered map shows. */
  directionIds?: number[];
  /** The drawn route lines as `[lat, lon]` points. */
  lines: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  /** The plotted stops, the fallback when there are no lines. */
  stops: ReadonlyArray<{ lat: number; lon: number }>;
}

/**
 * The route's vehicles that belong on a map. Distance is measured to the drawn
 * line, not to the nearest stop: stops can sit kilometres apart (Papakura to
 * Pukekohe is about 18km), so a stop test hid a train running between them. A
 * vehicle with no direction is left off a direction-filtered map, since it may be
 * running the other way.
 * @param vehicles - The route's live vehicles.
 * @param scope - What the map shows.
 * @returns The vehicles to draw.
 */
export function vehiclesOnMap(vehicles: LiveVehicle[], scope: VehicleMapScope): LiveVehicle[] {
  if (scope.tripId) return vehicles.filter((v) => v.tripId === scope.tripId);
  const { directionIds } = scope;
  // distanceToPathM takes the stored shape order, [lon, lat]. With no lines each
  // stop is its own one-point path.
  const paths =
    scope.lines.length > 0
      ? scope.lines.map((line) => line.map(([lat, lon]) => [lon, lat] as const))
      : scope.stops.map((s) => [[s.lon, s.lat] as const]);
  return vehicles.filter(
    (v) =>
      (!directionIds || (v.directionId != null && directionIds.includes(v.directionId))) &&
      (paths.length === 0 ||
        paths.some((p) => distanceToPathM(v.lat, v.lon, p) <= VEHICLE_MAX_OFF_LINE_M)),
  );
}
