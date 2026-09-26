// src/lib/fare-zone-geo.ts
// Which fare zone a point is in, against AT's published zone polygons, converted
// once from NZTM to WGS84 and simplified to about 15 m in fare-zones.json (see
// scripts/build-fare-zones.py). AT draws the land along some boundaries as
// overlaps that belong to both zones (Newmarket is City and Isthmus), so a stop
// there is in two zones. Unlike the hand-set areas in lib/areas.ts, a zone is
// exact, so a route serves every zone any one of its stops is in. Server only:
// the polygons are some 58 KB.
import { FARE_ZONES, type FareZoneKey } from "@/lib/fare-zones";
import ZONES from "@/lib/fare-zones.json";

/** A ring as `[lon, lat]` pairs, the GeoJSON order the JSON keeps. */
type Ring = number[][];

/** One zone's polygons (outer ring then holes), with a bounding box to skip most tests. */
interface ZoneShape {
  key: FareZoneKey;
  polygons: { rings: Ring[]; minLon: number; maxLon: number; minLat: number; maxLat: number }[];
}

const SHAPES: ZoneShape[] = (ZONES as { key: FareZoneKey; polygons: Ring[][] }[]).map((z) => ({
  key: z.key,
  polygons: z.polygons.map((rings) => {
    const outer = rings[0] ?? [];
    return {
      rings,
      minLon: Math.min(...outer.map((p) => p[0]!)),
      maxLon: Math.max(...outer.map((p) => p[0]!)),
      minLat: Math.min(...outer.map((p) => p[1]!)),
      maxLat: Math.max(...outer.map((p) => p[1]!)),
    };
  }),
}));

/**
 * Even-odd ray cast: a horizontal ray from the point crosses the ring's edges
 * an odd number of times exactly when the point is inside. Each edge counts
 * when it straddles the point's latitude (one end strictly above, one not) and
 * the crossing lies east of the point.
 * @param lon - Longitude.
 * @param lat - Latitude.
 * @param ring - The ring.
 * @returns True when the point is inside the ring.
 */
function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * The zones a point falls in: one, two on an overlap, or none outside AT's map.
 * @param lat - Latitude.
 * @param lon - Longitude.
 * @returns Zone keys in display order.
 */
export function fareZonesOf(lat: number, lon: number): FareZoneKey[] {
  const out: FareZoneKey[] = [];
  for (const z of SHAPES) {
    const hit = z.polygons.some(
      (p) =>
        lon >= p.minLon &&
        lon <= p.maxLon &&
        lat >= p.minLat &&
        lat <= p.maxLat &&
        inRing(lon, lat, p.rings[0]!) &&
        !p.rings.slice(1).some((hole) => inRing(lon, lat, hole)),
    );
    if (hit) out.push(z.key);
  }
  return out;
}

/**
 * The zones a route serves: every zone holding at least one of its stops.
 * @param stops - The route's stop coordinates.
 * @returns Zone keys in display order.
 */
export function routeFareZones(stops: ReadonlyArray<{ lat: number; lon: number }>): FareZoneKey[] {
  const hit = new Set<FareZoneKey>();
  for (const s of stops) for (const z of fareZonesOf(s.lat, s.lon)) hit.add(z);
  return FARE_ZONES.map((z) => z.key).filter((k) => hit.has(k));
}
