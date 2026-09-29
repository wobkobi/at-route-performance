// src/lib/map-frame.ts
// Where a map should open. Auckland's network is long and thin (Wellsford to
// Pukekohe is ten times the width of the isthmus), so framing every point puts
// the whole region in a wide box and leaves the city a small cluster in its middle.

/** Share of points left out at each end of each axis when framing the core. */
const CORE_TRIM = 0.02;

/**
 * The box holding most of the points: each axis cut at its {@link CORE_TRIM}
 * and 1 - CORE_TRIM quantiles, so a handful of far-flung vehicles do not set
 * the zoom for everyone. Each axis is trimmed on its own, so the box can drop a
 * point that is an outlier on only one of them; the dropped points stay on the
 * map, just outside the opening view. Under 20 points nothing is trimmed, since
 * there every point is a real share of what is running.
 * @param points - The points as [lat, lon].
 * @returns The south-west and north-east corners, or null with no points.
 */
export function coreBounds(
  points: readonly (readonly [number, number])[],
): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p[0]).sort((a, b) => a - b);
  const lons = points.map((p) => p[1]).sort((a, b) => a - b);
  const cut = points.length < 20 ? 0 : Math.floor(points.length * CORE_TRIM);
  const last = points.length - 1 - cut;
  return [
    [lats[cut]!, lons[cut]!],
    [lats[last]!, lons[last]!],
  ];
}
