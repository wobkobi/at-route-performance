// src/lib/gtfs-shapes.ts
import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";

/** AT's full GTFS feed (zip); `shapes.txt` holds road geometry per shape_id. */
const GTFS_ZIP_URL = process.env.AT_GTFS_ZIP_URL ?? "https://gtfs.at.govt.nz/gtfs.zip";

/** Cap points per shape; a city-zoom road line needs far fewer than every GPS fix. */
const MAX_POINTS = 150;

/** A simplified shape: ordered `[lon, lat]` pairs (GeoJSON order) for one shape_id. */
export interface ShapeGeom {
  id: string;
  points: [number, number][];
}

/** A raw shape point before grouping. */
interface RawPoint {
  seq: number;
  lat: number;
  lon: number;
}

/**
 * Downsample an ordered array to at most `max` items, always keeping the first
 * and last and spacing the rest evenly. Preserves overall shape at city zoom.
 * @param arr - Ordered items.
 * @param max - Maximum to keep.
 * @returns The downsampled array.
 */
function decimate<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

/**
 * Parse a GTFS `shapes.txt` into simplified per-shape geometries.
 * @param txt - The decompressed `shapes.txt` contents.
 * @returns One simplified {@link ShapeGeom} per shape_id.
 */
function parseShapes(txt: string): ShapeGeom[] {
  const lines = txt.split(/\r?\n/);
  const header = lines[0]?.split(",").map((h) => h.trim()) ?? [];
  const iId = header.indexOf("shape_id");
  const iLat = header.indexOf("shape_pt_lat");
  const iLon = header.indexOf("shape_pt_lon");
  const iSeq = header.indexOf("shape_pt_sequence");
  if (iId < 0 || iLat < 0 || iLon < 0 || iSeq < 0) {
    throw new Error("shapes.txt is missing expected columns");
  }

  const byId = new Map<string, RawPoint[]>();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = lines[i].split(",");
    const id = c[iId];
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    const seq = Number(c[iSeq]);
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let pts = byId.get(id);
    if (!pts) {
      pts = [];
      byId.set(id, pts);
    }
    pts.push({ seq, lat, lon });
  }

  const out: ShapeGeom[] = [];
  for (const [id, pts] of byId) {
    pts.sort((a, b) => a.seq - b.seq);
    out.push({
      id,
      points: decimate(pts, MAX_POINTS).map((p) => [p.lon, p.lat] as [number, number]),
    });
  }
  return out;
}

/**
 * Unzip filter: decompress only `shapes.txt`.
 * @param file - A zip entry being considered.
 * @returns True to decompress the entry.
 */
function onlyShapes(file: UnzipFileInfo): boolean {
  return file.name === "shapes.txt";
}

/**
 * Download AT's GTFS zip and extract simplified shape geometries from
 * `shapes.txt`. Only `shapes.txt` is decompressed.
 * @returns One simplified {@link ShapeGeom} per shape_id.
 * @throws {Error} When the download fails or `shapes.txt` is absent.
 */
export async function fetchShapes(): Promise<ShapeGeom[]> {
  const res = await fetch(GTFS_ZIP_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`GTFS zip ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(buf, { filter: onlyShapes });
  const data = files["shapes.txt"];
  if (!data) throw new Error("shapes.txt not found in the GTFS zip");
  return parseShapes(strFromU8(data));
}
