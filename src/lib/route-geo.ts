// src/lib/route-geo.ts
// Geometry for route polylines: thin a path to the detail a map needs, and
// offset a `[lat, lon]` path sideways
// by a fixed metric distance, perpendicular to its local direction, so a route's
// two directions draw as parallel lines either side of the road centreline rather
// than overlapping. Distances convert through a flat metres-per-degree
// approximation (with a longitude cos-latitude correction), which is accurate
// enough for an offset of a few metres anywhere; the shift uses the right-hand
// normal of each segment, flipped by `side` for the opposing direction.

/** Metres per degree of latitude (close enough anywhere for a small offset). */
const M_PER_DEG = 111_320;

/**
 * Perpendicular distance in metres from `p` to the line through `a` and `b`,
 * on the same flat approximation the offset uses.
 * @param p - The point, as `[lat, lon]`.
 * @param a - One end of the line.
 * @param b - The other end.
 * @returns The distance in metres.
 */
function perpMetres(p: [number, number], a: [number, number], b: [number, number]): number {
  const cosLat = Math.cos((a[0] * Math.PI) / 180) || 1e-6;
  const px = (p[1] - a[1]) * M_PER_DEG * cosLat;
  const py = (p[0] - a[0]) * M_PER_DEG;
  const bx = (b[1] - a[1]) * M_PER_DEG * cosLat;
  const by = (b[0] - a[0]) * M_PER_DEG;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);
  return Math.abs(px * by - py * bx) / Math.sqrt(len2);
}

/**
 * Ramer-Douglas-Peucker: keep the points where a `[lat, lon]` path bends by
 * more than `metres`, drop the near-collinear ones between them. Both endpoints
 * are always kept, and the order is preserved.
 *
 * The stored shapes are simplified to four metres, which is the detail a single
 * route's map wants and far more than a whole-network overlay can afford, so the
 * network layer thins them again. Iterative rather than recursive: a stored
 * shape runs to a thousand points, and the split is depth-first over index
 * spans rather than over copied slices.
 * @param points - The path as `[lat, lon]` pairs.
 * @param metres - Tolerance: drop a point within this of the line it sits on.
 * @returns The kept points (unchanged when fewer than three).
 */
export function simplifyPath(points: [number, number][], metres: number): [number, number][] {
  if (points.length < 3) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const spans: [number, number][] = [[0, points.length - 1]];
  for (let span = spans.pop(); span !== undefined; span = spans.pop()) {
    const [from, to] = span;
    const a = points[from];
    const b = points[to];
    if (a === undefined || b === undefined) continue;
    let worst = 0;
    let at = -1;
    for (let i = from + 1; i < to; i++) {
      const p = points[i];
      if (p === undefined) continue;
      const d = perpMetres(p, a, b);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at < 0 || worst <= metres) continue;
    keep[at] = true;
    spans.push([from, at], [at, to]);
  }
  return points.filter((_, i) => keep[i] === true);
}

/**
 * Offset a `[lat, lon]` polyline sideways by a fixed distance, perpendicular to
 * its local direction, so the two directions of a route draw as parallel lines
 * either side of the road centreline.
 * @param points - The path as `[lat, lon]` pairs.
 * @param metres - Offset distance in metres.
 * @param side - +1 for one side, -1 for the other (by `direction_id`).
 * @returns A new offset `[lat, lon]` path (unchanged when fewer than 2 points).
 */
export function offsetPath(
  points: [number, number][],
  metres: number,
  side: 1 | -1,
): [number, number][] {
  if (points.length < 2) return points;
  return points.map((point, i) => {
    const [lat, lon] = point;
    // Both indices are clamped to [0, length - 1], so the fallback to the
    // current point never fires; it matches the endpoint case (a zero-length
    // segment on that side) if it ever did.
    const prev = points[Math.max(0, i - 1)] ?? point;
    const next = points[Math.min(points.length - 1, i + 1)] ?? point;
    const cosLat = Math.cos((lat * Math.PI) / 180) || 1e-6;
    // Local segment direction in metres (east = x, north = y).
    const dx = (next[1] - prev[1]) * M_PER_DEG * cosLat;
    const dy = (next[0] - prev[0]) * M_PER_DEG;
    const len = Math.hypot(dx, dy) || 1;
    // Right-hand normal (dy, -dx), scaled to the offset distance.
    const offEast = (dy / len) * metres * side;
    const offNorth = (-dx / len) * metres * side;
    return [lat + offNorth / M_PER_DEG, lon + offEast / (M_PER_DEG * cosLat)] as [number, number];
  });
}
