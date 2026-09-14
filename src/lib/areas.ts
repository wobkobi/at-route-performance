// src/lib/areas.ts
// Broad areas of Auckland for the Routes page's area filter. AT's GTFS feed
// carries no zone for a stop (`zone_id` is empty on every one), so each stop is
// placed by its coordinates against hand-set boundaries, and a route belongs to
// every area it serves. The boundaries follow the natural dividers: the
// Waitemata Harbour for the North Shore, the upper harbour and the Whau for the
// West, the Tamaki River for the East, and the Mangere inlet and Otahuhu for
// the South. They are approximate at the edges (a stop a few hundred metres
// across a line can land in the neighbouring area), which is why a route needs
// more than one stop in an area to count as serving it.

/** An area key. */
export type AreaKey =
  "central" | "north" | "west" | "east" | "south" | "hibiscus-rodney" | "waiheke";

/** Every area in display order, with its label. */
export const AREAS: ReadonlyArray<{ key: AreaKey; label: string }> = [
  { key: "central", label: "Central" },
  { key: "north", label: "North Shore" },
  { key: "west", label: "West" },
  { key: "east", label: "East" },
  { key: "south", label: "South" },
  { key: "hibiscus-rodney", label: "Hibiscus Coast & Rodney" },
  { key: "waiheke", label: "Waiheke & islands" },
];

/** Area key to its label. */
export const AREA_LABEL: Record<AreaKey, string> = Object.fromEntries(
  AREAS.map((a) => [a.key, a.label]),
) as Record<AreaKey, string>;

/**
 * Whether a string is an area key.
 * @param value - Candidate key, e.g. from a query param.
 * @returns True when it names an area.
 */
export function isAreaKey(value: string): value is AreaKey {
  return AREAS.some((a) => a.key === value);
}

/**
 * The area a point falls in. The checks run in order and each assumes the ones
 * before it failed: the gulf islands, then everything north of Albany, the West,
 * the North Shore, the South, the East, and Central as what is left.
 * @param lat - Latitude (negative, south of the equator).
 * @param lon - Longitude.
 * @returns The area key.
 */
export function areaOf(lat: number, lon: number): AreaKey {
  // Waiheke and the other gulf islands sit east of 174.95 and north of the
  // Beachlands and Pine Harbour coast.
  if (lon >= 174.95 && lat > -36.86) return "waiheke";
  // North of Albany: Dairy Flat, Silverdale, Orewa, Whangaparaoa, Helensville, Warkworth.
  if (lat > -36.7) return "hibiscus-rodney";
  // West: south of the harbour the Whau (about 174.695) splits New Lynn from
  // Avondale; north of it the line runs up past Te Atatu to Hobsonville, with
  // Paremoremo across the upper harbour carved back out to the North Shore.
  if (lat > -37) {
    const southOfHarbour = lat <= -36.86 && lon < 174.695;
    const northOfHarbour = lat > -36.86 && lon < 174.676 && !(lat > -36.785 && lon >= 174.655);
    if (southOfHarbour || northOfHarbour) return "west";
  }
  // North Shore: across the Waitemata from Westhaven and the city (about -36.835).
  if (lat > -36.835) return "north";
  // South: from Mangere Bridge and Otahuhu down. East of the Tamaki the line
  // steps south twice, past Otara and Manukau, so Botany, Flat Bush and
  // Ormiston stay East.
  const south =
    (lon < 174.866 && lat < -36.935) || (lon < 174.895 && lat < -36.955) || lat < -36.99;
  if (south) return "south";
  // East: across the Tamaki River from Glendowie and Panmure.
  if ((lat > -36.89 && lon >= 174.883) || (lat <= -36.89 && lon >= 174.866)) return "east";
  return "central";
}

/**
 * The areas a route serves, from its stops. An area counts when it holds at
 * least two of the route's stops or a quarter of them, so one stop just over a
 * boundary does not add an area, while a two-stop ferry still gets both ends.
 * A route whose stops meet neither bar keeps the area with the most of them.
 * @param stops - The route's stop coordinates (distinct stops).
 * @returns Area keys in display order; empty only when there are no stops.
 */
export function routeAreas(stops: ReadonlyArray<{ lat: number; lon: number }>): AreaKey[] {
  if (stops.length === 0) return [];
  const counts = new Map<AreaKey, number>();
  for (const s of stops) {
    const key = areaOf(s.lat, s.lon);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const served = AREAS.map((a) => a.key).filter((key) => {
    const n = counts.get(key) ?? 0;
    return n >= 2 || n / stops.length >= 0.25;
  });
  if (served.length > 0) return served;
  const [top] = [...counts].sort((a, b) => b[1] - a[1]);
  return top ? [top[0]] : [];
}
