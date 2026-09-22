// src/lib/vehicle-detail.ts
// Pure helpers for one vehicle's page: its name, how full the feed says it is,
// where it ranks on the hardest-worked board, and each run's figures.

import { routeSlug } from "@/lib/route-slug";
import { nzServiceDayString } from "@/lib/time";
import type { VehicleTotal } from "@/lib/vehicle-rank";

/**
 * The trip page for the run a live vehicle is carrying, on today's service day.
 * @param v - The live vehicle's run.
 * @param v.routeId - Its route id.
 * @param v.tripId - Its trip id.
 * @returns The page path.
 */
export function liveRunHref({ routeId, tripId }: { routeId: string; tripId: string }): string {
  return `/route/${encodeURIComponent(routeSlug(routeId))}/trip/${encodeURIComponent(tripId)}?d=${nzServiceDayString()}`;
}

/** Feed vehicle ids are all digits; anything else is not a vehicle page. */
export const VEHICLE_ID = /^[0-9]{1,12}$/;

/**
 * GTFS-RT occupancy status, in the feed's order. AT sends 0 to 3 in practice;
 * the rest are named so a new value still reads as words.
 */
const OCCUPANCY = [
  "Empty",
  "Plenty of seats",
  "Few seats left",
  "Standing room only",
  "Packed",
  "Full",
  "Not taking passengers",
] as const;

/**
 * The feed's occupancy status in words.
 * @param status - The status number, or null when the feed sent none.
 * @returns The words, or null for a missing or unknown status.
 */
export function occupancyLabel(status: number | null): string | null {
  if (status == null || !Number.isInteger(status)) return null;
  return OCCUPANCY[status] ?? null;
}

/**
 * What to call a vehicle: its fleet label when the register or the feed has
 * one, else its feed id.
 * @param label - The fleet label, if known.
 * @param id - The feed id.
 * @returns The name.
 */
export function vehicleName(label: string | null | undefined, id: string): string {
  return label?.trim() || `Vehicle ${id}`;
}

/**
 * Where a vehicle sits on an already-sorted board.
 * @param sorted - The board, hardest-worked first.
 * @param id - The vehicle.
 * @returns Its 1-based rank and the board size, or null when it is not on it.
 */
export function vehicleRank(
  sorted: VehicleTotal[],
  id: string,
): { rank: number; of: number } | null {
  const i = sorted.findIndex((v) => v.vehicleId === id);
  return i === -1 ? null : { rank: i + 1, of: sorted.length };
}

/** One run a vehicle carried, as the per-day query returns it. */
export interface VehicleRunRow {
  tripId: string;
  routeId: string;
  /** Earliest scheduled stop time, epoch ms. */
  startMs: number;
  /** First and last recorded arrival, epoch ms. */
  firstMs: number;
  lastMs: number;
  /** Arrivals recorded. */
  e: number;
  /** Sum of signed deviation, seconds. */
  dev: number;
  /** Sum of absolute deviation, seconds. */
  abs: number;
  /** Carriages, for a train run. */
  cars: number | null;
}

/**
 * A run's averages and length from its sums.
 * @param run - The run.
 * @returns Signed and absolute average deviation, and seconds from its first
 *   recorded arrival to its last.
 */
export function runFigures(run: VehicleRunRow): {
  avgSec: number;
  avgAbsSec: number;
  durationSec: number;
} {
  const n = Math.max(1, run.e);
  return {
    avgSec: run.dev / n,
    avgAbsSec: run.abs / n,
    durationSec: Math.max(0, Math.round((run.lastMs - run.firstMs) / 1000)),
  };
}
