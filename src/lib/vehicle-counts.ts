// src/lib/vehicle-counts.ts
// Distinct vehicles per mode over one or more service days, for the home page's
// vehicles section.

/** The three modes a vehicle is counted under. */
export type VehicleMode = "BUS" | "TRAIN" | "FERRY";

/** The modes in display order. */
export const VEHICLE_MODES: readonly VehicleMode[] = ["BUS", "TRAIN", "FERRY"];

/** Distinct vehicle ids, split by mode. */
export type VehiclesByMode = Record<VehicleMode, string[]>;

/** Distinct vehicles per mode across a window. */
export type VehicleCounts = Record<VehicleMode, number>;

/** One vehicle as the per-day aggregation returns it: its id and a route it ran. */
export interface VehicleRouteRow {
  v: string;
  r: string;
}

/**
 * Split one day's vehicles by the mode of the route each ran. A vehicle on a
 * route missing from the mode map is left out rather than guessed.
 * @param rows - One row per distinct vehicle.
 * @param modeOf - Route id > mode.
 * @returns The day's vehicle ids per mode.
 */
export function vehiclesByMode(
  rows: VehicleRouteRow[],
  modeOf: Map<string, VehicleMode>,
): VehiclesByMode {
  const out: VehiclesByMode = { BUS: [], TRAIN: [], FERRY: [] };
  for (const { v, r } of rows) {
    const mode = modeOf.get(r);
    if (mode) out[mode].push(v);
  }
  return out;
}

/**
 * Union several days' vehicles per mode, so a bus seen on every day of a week
 * is listed once.
 * @param days - Each day's vehicles per mode.
 * @returns The distinct ids per mode.
 */
export function mergeVehicles(days: VehiclesByMode[]): VehiclesByMode {
  const out: VehiclesByMode = { BUS: [], TRAIN: [], FERRY: [] };
  for (const mode of VEHICLE_MODES) {
    out[mode] = [...new Set(days.flatMap((d) => d[mode]))];
  }
  return out;
}

/**
 * Count distinct vehicles per mode across several days.
 * @param days - Each day's vehicles per mode.
 * @returns Distinct vehicles per mode.
 */
export function countVehicles(days: VehiclesByMode[]): VehicleCounts {
  const merged = mergeVehicles(days);
  return { BUS: merged.BUS.length, TRAIN: merged.TRAIN.length, FERRY: merged.FERRY.length };
}
