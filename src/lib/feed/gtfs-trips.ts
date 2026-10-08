// src/lib/feed/gtfs-trips.ts
// Fetch and parse per-trip headsign, direction and shape from the AT GTFS feed's `trips.txt`,
// topped up from AT's v3 API for the routes the zip leaves out. The public zip omits every
// school route (S454 and some 300 more), though the API lists them and their trips. The
// same read builds each zip route's stopping patterns, so the route page need not ask AT.
import { groupBy } from "@/lib/collections";
import { fetchAll } from "@/lib/feed/at-static";
import { parseAgencies, type AgencyRecord } from "@/lib/feed/gtfs-agencies";
import { readStopTimes } from "@/lib/feed/gtfs-stop-ends";
import { patternVariants, topPatternGroups, type PatternGroup } from "@/lib/route/pattern-groups";
import { sleep } from "@/lib/utils";
import type { RouteVariant } from "@/types/api";
import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";

/** AT's full GTFS feed (zip); `trips.txt` holds headsign, direction and shape per trip_id. */
const GTFS_ZIP_URL = process.env.AT_GTFS_ZIP_URL ?? "https://gtfs.at.govt.nz/gtfs.zip";

/**
 * Routes fetched from the API at once. AT has no bulk trips endpoint (`/trips` is a 404), so
 * each missing route costs one call; a small pool keeps a few hundred of them to seconds.
 */
const API_CONCURRENCY = 4;

/**
 * Pause before retrying the routes the pool could not fetch. A burst of a few hundred calls can
 * still run into AT's rate limit (429) past the client's own 1-2-4s backoff; the limit clears
 * within the half minute, so the retry pass after it nearly always succeeds.
 */
const RETRY_PAUSE_MS = 30_000;

/** GTFS trip attributes (subset) from `/routes/{id}/trips`. */
interface ApiTripAttr {
  trip_id: string;
  direction_id?: number | null;
  shape_id?: string | null;
  trip_headsign?: string | null;
}

/** One parsed row from `trips.txt`. */
export interface TripRecord {
  id: string;
  routeId: string;
  headsign: string | null;
  directionId: number | null;
  shapeId: string | null;
  /** The trip's opening stops, in order; absent for a trip the zip has no stop times for. */
  startStopIds?: string[];
  /** The trip's last stop; absent alongside {@link TripRecord.startStopIds}. */
  lastStopId?: string;
}

/**
 * Parse a GTFS `trips.txt` into trip records.
 * @param txt - The decompressed `trips.txt` contents.
 * @returns One {@link TripRecord} per row.
 */
function parseTrips(txt: string): TripRecord[] {
  const lines = txt.split(/\r?\n/);
  const header = lines[0]?.split(",").map((h) => h.trim()) ?? [];
  const iId = header.indexOf("trip_id");
  const iRoute = header.indexOf("route_id");
  const iHeadsign = header.indexOf("trip_headsign");
  const iDir = header.indexOf("direction_id");
  const iShape = header.indexOf("shape_id");
  if (iId < 0 || iRoute < 0) throw new Error("trips.txt is missing expected columns");

  const out: TripRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const c = line.split(",");
    const id = c[iId]?.trim();
    const routeId = c[iRoute]?.trim();
    if (!id || !routeId) continue;
    const headsign = iHeadsign >= 0 ? c[iHeadsign]?.trim() || null : null;
    // A missing direction column parses to NaN, same as an empty cell.
    const dirRaw = iDir >= 0 ? parseInt(c[iDir] ?? "", 10) : NaN;
    const shapeId = iShape >= 0 ? c[iShape]?.trim() || null : null;
    out.push({
      id,
      routeId,
      headsign,
      directionId: Number.isFinite(dirRaw) ? dirRaw : null,
      shapeId,
    });
  }
  return out;
}

/**
 * Unzip filter: decompress only `trips.txt` and `agency.txt`.
 * @param file - A zip entry being considered.
 * @returns True to decompress the entry.
 */
function onlyTripsAndAgencies(file: UnzipFileInfo): boolean {
  return file.name === "trips.txt" || file.name === "agency.txt";
}

/** A route's stopping pattern as the sync stores it: the variants of every direction. */
export interface PatternRecord {
  routeId: string;
  variants: RouteVariant[];
}

/**
 * Each route's pattern groups from its zip trips, with the representative trips
 * whose whole stop order `stop_times.txt` must yield.
 * @param trips - Trips parsed from `trips.txt`, in file order.
 * @returns The groups by route, and every representative trip id.
 */
export function patternGroupsByRoute(trips: readonly TripRecord[]): {
  groups: Map<string, PatternGroup[]>;
  representatives: Set<string>;
} {
  const groups = new Map<string, PatternGroup[]>();
  const representatives = new Set<string>();
  for (const [routeId, routeTrips] of groupBy(trips, (t) => t.routeId)) {
    const top = topPatternGroups(
      routeTrips.map((t) => ({
        tripId: t.id,
        directionId: t.directionId,
        shapeId: t.shapeId,
        headsign: t.headsign,
      })),
    );
    groups.set(routeId, top);
    for (const g of top) representatives.add(g.tripId);
  }
  return { groups, representatives };
}

/**
 * Download AT's GTFS zip and extract trip metadata from `trips.txt`, each
 * trip's opening and last stops from `stop_times.txt` ({@link readStopTimes},
 * streamed), each route's stopping pattern from the same read, and the
 * operator list from `agency.txt`.
 * @returns One {@link TripRecord} per trip in the feed, one pattern per route with a
 *   usable variant, and one agency per operator; no agencies when `agency.txt` is
 *   absent, so the stored list stands.
 * @throws {Error} When the download fails or `trips.txt` or `stop_times.txt` is absent.
 */
export async function fetchTripsAndAgencies(): Promise<{
  trips: TripRecord[];
  patterns: PatternRecord[];
  agencies: AgencyRecord[];
}> {
  const res = await fetch(GTFS_ZIP_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`GTFS zip ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(buf, { filter: onlyTripsAndAgencies });
  const data = files["trips.txt"];
  if (!data) throw new Error("trips.txt not found in the GTFS zip");
  const agency = files["agency.txt"];
  // Trips first, so the stop_times pass knows which few trips to keep whole.
  const parsed = parseTrips(strFromU8(data));
  const { groups, representatives } = patternGroupsByRoute(parsed);
  const { ends, sequences } = readStopTimes(buf, representatives);
  const patterns: PatternRecord[] = [];
  for (const [routeId, routeGroups] of groups) {
    const variants = patternVariants(routeGroups, (tripId) => sequences.get(tripId));
    if (variants.length > 0) patterns.push({ routeId, variants });
  }
  return {
    trips: parsed.map((t) => ({ ...t, ...ends.get(t.id) })),
    patterns,
    agencies: agency ? parseAgencies(strFromU8(agency)) : [],
  };
}

/**
 * The routes AT publishes that have no trip in the zip, in the order given.
 * @param zipTrips - Trips parsed from the zip.
 * @param routeIds - Every route id AT's API lists.
 * @returns Route ids with no zip trip.
 */
export function routesMissingFromZip(
  zipTrips: ReadonlyArray<TripRecord>,
  routeIds: ReadonlyArray<string>,
): string[] {
  const inZip = new Set(zipTrips.map((t) => t.routeId));
  return [...new Set(routeIds)].filter((id) => !inZip.has(id));
}

/**
 * Fetch trip metadata for each route from AT's v3 API in two passes: a small pool first, then,
 * after {@link RETRY_PAUSE_MS}, the routes that failed one at a time. A route that fails both
 * passes is skipped and counted, so one bad route does not cost the rest of the sync.
 * @param routeIds - Route ids to fetch.
 * @param retryPauseMs - Pause before the retry pass.
 * @returns The trips found, and how many routes failed both passes.
 */
export async function fetchRouteTrips(
  routeIds: ReadonlyArray<string>,
  retryPauseMs = RETRY_PAUSE_MS,
): Promise<{ trips: TripRecord[]; failed: number }> {
  const trips: TripRecord[] = [];
  /**
   * Fetch one route's trips into `trips`.
   * @param routeId - The route.
   * @param final - True on the retry pass, where a failure is logged.
   * @returns True when the route's trips were fetched.
   */
  const fetchOne = async (routeId: string, final: boolean): Promise<boolean> => {
    try {
      const rows = await fetchAll<ApiTripAttr>(`/routes/${encodeURIComponent(routeId)}/trips`);
      for (const r of rows) {
        if (!r.trip_id) continue;
        trips.push({
          id: r.trip_id,
          routeId,
          headsign: r.trip_headsign?.trim() || null,
          directionId: typeof r.direction_id === "number" ? r.direction_id : null,
          shapeId: r.shape_id?.trim() || null,
        });
      }
      return true;
    } catch (error) {
      if (final) {
        console.warn("[TRIPS] Route trips fetch failed twice", {
          routeId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return false;
    }
  };

  // First pass: workers pull route ids off a shared queue.
  const retry: string[] = [];
  let next = 0;
  /** Take route ids off the queue until it is empty, keeping the failures for the retry pass. */
  const worker = async (): Promise<void> => {
    while (next < routeIds.length) {
      const routeId = routeIds[next++]!;
      if (!(await fetchOne(routeId, false))) retry.push(routeId);
    }
  };
  await Promise.all(Array.from({ length: Math.min(API_CONCURRENCY, routeIds.length) }, worker));

  // Retry pass: one at a time, once the rate limit has had time to clear.
  let failed = 0;
  if (retry.length > 0) {
    await sleep(retryPauseMs);
    for (const routeId of retry) if (!(await fetchOne(routeId, true))) failed++;
  }
  return { trips, failed };
}
