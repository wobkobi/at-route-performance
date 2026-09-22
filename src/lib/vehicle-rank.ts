// src/lib/vehicle-rank.ts
// Rank individual vehicles by how hard they were worked: time in service, runs
// and arrivals, merged from per-day rows.

import type { VehicleMode } from "@/lib/vehicle-counts";

/** One vehicle's work on one service day, as the per-day aggregation returns it. */
export interface VehicleDayRow {
  /** Feed vehicle id. */
  v: string;
  /** Mode of the first route it ran that day. */
  m: VehicleMode;
  /** Runs (distinct trips) it carried. */
  r: number;
  /** Seconds in service: each run's first to last recorded arrival, summed. */
  s: number;
  /** Arrivals recorded. */
  e: number;
  /** Sum of absolute deviation over those arrivals, in seconds. */
  a: number;
  /** Routes it ran. */
  routes: string[];
}

/** One vehicle's work across a window. */
export interface VehicleTotal {
  vehicleId: string;
  mode: VehicleMode;
  runs: number;
  serviceSec: number;
  arrivals: number;
  /** Average absolute deviation per arrival, in seconds. */
  avgOffSec: number;
  routes: string[];
  /** Service days it ran on. */
  days: number;
}

/** What the board can rank by. */
export type VehicleSort = "hours" | "runs" | "arrivals" | "off";

export const VEHICLE_SORTS: readonly VehicleSort[] = ["hours", "runs", "arrivals", "off"];

/**
 * Parse `?sort`, defaulting to time in service.
 * @param raw - The raw query value.
 * @returns The sort.
 */
export function parseVehicleSort(raw: string | undefined): VehicleSort {
  return VEHICLE_SORTS.includes(raw as VehicleSort) ? (raw as VehicleSort) : "hours";
}

/**
 * Merge per-day rows into one total per vehicle. The average off-schedule is
 * rebuilt from the summed deviation, so a busy day weighs more than a quiet one.
 * @param days - Each day's rows.
 * @returns One total per vehicle, unordered.
 */
export function mergeVehicleDays(days: VehicleDayRow[][]): VehicleTotal[] {
  const acc = new Map<
    string,
    {
      mode: VehicleMode;
      r: number;
      s: number;
      e: number;
      a: number;
      routes: Set<string>;
      d: number;
    }
  >();
  for (const day of days) {
    for (const row of day) {
      const cur = acc.get(row.v);
      if (cur) {
        cur.r += row.r;
        cur.s += row.s;
        cur.e += row.e;
        cur.a += row.a;
        cur.d += 1;
        for (const id of row.routes) cur.routes.add(id);
      } else {
        acc.set(row.v, {
          mode: row.m,
          r: row.r,
          s: row.s,
          e: row.e,
          a: row.a,
          routes: new Set(row.routes),
          d: 1,
        });
      }
    }
  }
  return [...acc].map(([vehicleId, t]) => ({
    vehicleId,
    mode: t.mode,
    runs: t.r,
    serviceSec: t.s,
    arrivals: t.e,
    avgOffSec: t.e > 0 ? Math.round((t.a / t.e) * 10) / 10 : 0,
    routes: [...t.routes].sort((x, y) => x.localeCompare(y, "en-NZ", { numeric: true })),
    days: t.d,
  }));
}

/**
 * Order vehicles by the chosen measure, hardest-worked first. Ties fall to time
 * in service, then to the vehicle id, so the order is stable between renders.
 * @param list - The vehicles.
 * @param sort - What to rank by.
 * @returns A new, sorted array.
 */
export function sortVehicles(list: VehicleTotal[], sort: VehicleSort): VehicleTotal[] {
  /**
   * The figure the chosen sort ranks by.
   * @param t - A vehicle.
   * @returns Its figure.
   */
  const key = (t: VehicleTotal): number =>
    sort === "runs"
      ? t.runs
      : sort === "arrivals"
        ? t.arrivals
        : sort === "off"
          ? t.avgOffSec
          : t.serviceSec;
  return [...list].sort(
    (x, y) =>
      key(y) - key(x) || y.serviceSec - x.serviceSec || x.vehicleId.localeCompare(y.vehicleId),
  );
}
