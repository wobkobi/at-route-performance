// src/lib/route-geo.ts

/** Metres per degree of latitude (close enough anywhere for a small offset). */
const M_PER_DEG = 111_320;

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
  return points.map(([lat, lon], i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
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
