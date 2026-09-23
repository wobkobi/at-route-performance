// src/lib/data/ghost-runs.ts
// Runs the nightly pass hid outright, read both ways round for the trip page:
// the hidden run's own row, and the row naming a run whose readings AT filed
// under someone else's number. Every clock label is derived from the trip id's
// start seconds against the run's own service day, so nothing here depends on a
// stored instant.
import { prisma } from "@/lib/db";
import { unstable_cache } from "@/lib/mem-cache";
import { nzClockTime, nzServiceDayRange, serviceDayClockInstant } from "@/lib/time";
import { tripIdStartSeconds } from "@/lib/trip-id";

/** One hidden run, for the trip page. */
export interface GhostRunRow {
  trip_id: string;
  route_id: string;
  /** The run's own NZ service date (`YYYY-MM-DD`). */
  service_date: string;
  /** Auckland clock time this run was scheduled to start, or null when its id encodes none. */
  label: string | null;
  /** Seconds the readings sat off the schedule they were filed against. */
  level_sec: number;
  /** Distinct stops the readings covered. */
  readings: number;
  vehicle_id: string | null;
  /** The run these readings describe, when the sibling test named one. */
  belongs_to: { trip_id: string; label: string | null } | null;
  /** Which tests fired: "anchor", "silent-sibling". */
  evidence: string[];
}

/** The stored columns both lookups read. */
const SELECT = {
  tripId: true,
  routeId: true,
  serviceDate: true,
  levelSec: true,
  readings: true,
  vehicleId: true,
  belongsToTripId: true,
  evidence: true,
} as const;

/** A stored hidden run, as the two lookups select it. */
interface StoredGhostRun {
  tripId: string;
  routeId: string;
  serviceDate: string;
  levelSec: number;
  readings: number;
  vehicleId: string | null;
  belongsToTripId: string | null;
  evidence: string[];
}

/**
 * The Auckland clock time a run was scheduled to start, from the start seconds
 * its trip id encodes placed on its own service day. A rider recognises a run by
 * its departure time, not by a trip id, so every mention of another run carries
 * one.
 * @param tripId - AT GTFS trip id.
 * @param serviceDate - The run's service date (`YYYY-MM-DD`).
 * @returns The clock label, or null when the id encodes no start.
 */
function startLabel(tripId: string, serviceDate: string): string | null {
  const sec = tripIdStartSeconds(tripId);
  if (sec === null) return null;
  return nzClockTime(
    serviceDayClockInstant(nzServiceDayRange(serviceDate).start, sec).toISOString(),
  );
}

/**
 * Shape a stored row for the page.
 * @param row - The stored hidden run.
 * @returns The page row, with both clock labels resolved.
 */
function toRow(row: StoredGhostRun): GhostRunRow {
  return {
    trip_id: row.tripId,
    route_id: row.routeId,
    service_date: row.serviceDate,
    label: startLabel(row.tripId, row.serviceDate),
    level_sec: row.levelSec,
    readings: row.readings,
    vehicle_id: row.vehicleId,
    belongs_to:
      row.belongsToTripId === null
        ? null
        : {
            trip_id: row.belongsToTripId,
            label: startLabel(row.belongsToTripId, row.serviceDate),
          },
    evidence: row.evidence,
  };
}

/**
 * The hidden-run record for one run of a trip, if the nightly pass wrote one. A
 * trip id repeats every service day, so the record is looked up for the run's
 * own day; with no day (an undated link to a trip that recorded nothing) it
 * takes the trip's most recent record. Cached for five minutes, matching the
 * cancellation lookup beside it.
 * @param tripId - AT GTFS trip id.
 * @param serviceDate - The run's service date (`YYYY-MM-DD`), or null for the latest.
 * @returns The record, or null when the run was never hidden.
 */
export async function getGhostRun(
  tripId: string,
  serviceDate: string | null,
): Promise<GhostRunRow | null> {
  return unstable_cache(
    async () => {
      const row = await prisma.ghostRun.findFirst({
        where: { tripId, ...(serviceDate === null ? {} : { serviceDate }) },
        orderBy: { serviceDate: "desc" },
        select: SELECT,
      });
      return row === null ? null : toRow(row);
    },
    ["ghost-run", tripId, serviceDate ?? "latest"],
    { revalidate: 300 },
  )();
}

/**
 * The hidden run whose readings the sibling test said belong to this trip, so
 * the trip that recorded nothing can say why. Bounded by the `serviceDate`
 * index, whose day holds a single-figure number of records, so the residual
 * match on `belongsToTripId` needs no index of its own.
 * @param belongsToTripId - The trip whose readings were filed elsewhere.
 * @param serviceDate - The service date to look in (`YYYY-MM-DD`).
 * @returns The record naming this trip, or null when none does.
 */
export async function getGhostRunFor(
  belongsToTripId: string,
  serviceDate: string,
): Promise<GhostRunRow | null> {
  return unstable_cache(
    async () => {
      const row = await prisma.ghostRun.findFirst({
        where: { belongsToTripId, serviceDate },
        select: SELECT,
      });
      return row === null ? null : toRow(row);
    },
    ["ghost-run-for", belongsToTripId, serviceDate],
    { revalidate: 300 },
  )();
}
