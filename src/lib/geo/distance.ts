// Ground distances on a flat approximation: longitude scaled by the cosine of
// the latitude. Accurate to well under a percent across a city, which is all
// the map, strip and shape maths ever measure, and far cheaper than haversine.

/** Metres per degree of latitude. */
export const M_PER_DEG = 111_320;

/** A point as `[lat, lon]`, the order Leaflet and the site's own maths use. */
export type LatLon = readonly [lat: number, lon: number];

/** A point as `[lon, lat]`, the GeoJSON order stored shapes use. */
export type LonLat = readonly [lon: number, lat: number];

/**
 * Metres between two points.
 * @param a - The first point.
 * @param b - The second point.
 * @returns The distance in metres.
 */
export function metresBetween(a: LatLon, b: LatLon): number {
  const cosLat = Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * M_PER_DEG, (b[1] - a[1]) * M_PER_DEG * cosLat);
}

/**
 * Perpendicular distance in metres from `p` to the line through `a` and `b`,
 * or to `a` itself when the two ends coincide. The line is projected flat
 * around `a`; the tiny floor on its cosine keeps a pole-side point finite.
 * @param p - The point.
 * @param a - One end of the line.
 * @param b - The other end.
 * @returns The distance in metres.
 */
export function perpMetres(p: LatLon, a: LatLon, b: LatLon): number {
  const cosLat = Math.cos((a[0] * Math.PI) / 180) || 1e-6;
  const px = (p[1] - a[1]) * M_PER_DEG * cosLat;
  const py = (p[0] - a[0]) * M_PER_DEG;
  const bx = (b[1] - a[1]) * M_PER_DEG * cosLat;
  const by = (b[0] - a[0]) * M_PER_DEG;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);
  return Math.abs(px * by - py * bx) / Math.sqrt(len2);
}
