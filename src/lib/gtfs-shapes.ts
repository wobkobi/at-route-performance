// src/lib/gtfs-shapes.ts
import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";

/** AT's full GTFS feed (zip); `shapes.txt` holds road geometry per shape_id. */
const GTFS_ZIP_URL = process.env.AT_GTFS_ZIP_URL ?? "https://gtfs.at.govt.nz/gtfs.zip";

/** Simplification tolerance in metres: drop points within this of the line. */
const TOLERANCE_M = 4;

/** Hard cap on points per shape (safety for extremely long/curvy shapes). */
const MAX_POINTS = 1000;

/** Metres per degree of latitude (good enough locally for simplification). */
const M_PER_DEG = 111_320;

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
 * Perpendicular distance (metres) from point `p` to the line through `a`-`b`,
 * using a local planar approximation (lon scaled by cos(lat)).
 * @param p - The point.
 * @param a - Line start.
 * @param b - Line end.
 * @returns Distance in metres.
 */
function perpDistM(p: RawPoint, a: RawPoint, b: RawPoint): number {
  const cosLat = Math.cos((a.lat * Math.PI) / 180) || 1e-6;
  const px = (p.lon - a.lon) * M_PER_DEG * cosLat;
  const py = (p.lat - a.lat) * M_PER_DEG;
  const bx = (b.lon - a.lon) * M_PER_DEG * cosLat;
  const by = (b.lat - a.lat) * M_PER_DEG;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);
  return Math.abs(px * by - py * bx) / Math.sqrt(len2);
}

/**
 * Ramer-Douglas-Peucker simplification: keep points where the path bends beyond
 * `epsM` metres, drop near-collinear ones. Follows the road far more closely
 * than even spacing for the same point budget.
 * @param pts - Ordered points.
 * @param epsM - Tolerance in metres.
 * @returns The simplified points (endpoints always kept).
 */
function simplify(pts: RawPoint[], epsM: number): RawPoint[] {
  if (pts.length < 3) return pts;
  let maxD = 0;
  let idx = 0;
  const first = pts[0];
  const last = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDistM(pts[i], first, last);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= epsM) return [first, last];
  const left = simplify(pts.slice(0, idx + 1), epsM);
  const right = simplify(pts.slice(idx), epsM);
  return [...left.slice(0, -1), ...right];
}

/**
 * Downsample an ordered array to at most `max` items (evenly spaced, endpoints
 * kept). A safety net after simplification for pathologically long shapes.
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
    const kept = decimate(simplify(pts, TOLERANCE_M), MAX_POINTS);
    out.push({ id, points: kept.map((p) => [p.lon, p.lat] as [number, number]) });
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
