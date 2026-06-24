// src/lib/gtfs-trips.ts
import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";

/** AT's full GTFS feed (zip); `trips.txt` holds headsign + direction per trip_id. */
const GTFS_ZIP_URL = process.env.AT_GTFS_ZIP_URL ?? "https://gtfs.at.govt.nz/gtfs.zip";

/** One parsed row from `trips.txt`. */
export interface TripRecord {
  id: string;
  routeId: string;
  headsign: string | null;
  directionId: number | null;
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
  if (iId < 0 || iRoute < 0) throw new Error("trips.txt is missing expected columns");

  const out: TripRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = lines[i].split(",");
    const id = c[iId]?.trim();
    const routeId = c[iRoute]?.trim();
    if (!id || !routeId) continue;
    const headsign = iHeadsign >= 0 ? c[iHeadsign]?.trim() || null : null;
    const dirRaw = iDir >= 0 ? parseInt(c[iDir], 10) : NaN;
    out.push({ id, routeId, headsign, directionId: Number.isFinite(dirRaw) ? dirRaw : null });
  }
  return out;
}

/**
 * Unzip filter: decompress only `trips.txt`.
 * @param file - A zip entry being considered.
 * @returns True to decompress the entry.
 */
function onlyTrips(file: UnzipFileInfo): boolean {
  return file.name === "trips.txt";
}

/**
 * Download AT's GTFS zip and extract trip metadata from `trips.txt`.
 * Only `trips.txt` is decompressed.
 * @returns One {@link TripRecord} per trip in the feed.
 * @throws {Error} When the download fails or `trips.txt` is absent.
 */
export async function fetchTrips(): Promise<TripRecord[]> {
  const res = await fetch(GTFS_ZIP_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`GTFS zip ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(buf, { filter: onlyTrips });
  const data = files["trips.txt"];
  if (!data) throw new Error("trips.txt not found in the GTFS zip");
  return parseTrips(strFromU8(data));
}
