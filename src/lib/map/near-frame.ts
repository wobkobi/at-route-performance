// src/lib/map/near-frame.ts
// The view the live map's "Near me" button lands on: the reader centred, with
// enough around them to take in the nearest few vehicles, and no closer or
// wider than a street-level look needs. Pure, so the framing is testable
// without a map.

import { M_PER_DEG, metresBetween } from "@/lib/geo/distance";

/** How many of the nearest vehicles the frame reaches out to take in. */
const NEAREST = 5;

/** Smallest half-width of the frame, in metres: a few blocks, so the reader's street reads. */
const MIN_RADIUS_M = 250;

/**
 * Furthest the frame reaches for vehicles, in metres. A reader with nothing
 * near would otherwise be framed out to the suburb next door, which is no
 * longer "near me".
 */
const MAX_REACH_M = 1_500;

/**
 * An accuracy worse than this, in metres, is a network or IP guess rather than a
 * fix (a desktop browser without GPS). The frame then shows the whole area the
 * reader could be in, since zooming to a street on a guess would be a claim.
 */
const ROUGH_FIX_M = 1_500;

/** Widest a rough fix is framed, in metres, so a 50 km guess still shows streets. */
const MAX_ROUGH_RADIUS_M = 8_000;

/** A lat/lon box as `[[south, west], [north, east]]`, the form Leaflet takes. */
export type LatLonBox = [[number, number], [number, number]];

/**
 * The frame for a located reader: a square centred on them, so they land in the
 * middle of the map. Its half-width is the distance to the furthest of the
 * {@link NEAREST} nearest vehicles within {@link MAX_REACH_M}, never under
 * {@link MIN_RADIUS_M} and never smaller than the fix's own accuracy circle. A
 * rough fix frames its accuracy circle alone, capped at {@link MAX_ROUGH_RADIUS_M}.
 * @param here - The reader as `[lat, lon]`.
 * @param accuracyM - The fix's accuracy radius in metres, as the browser reports it.
 * @param vehicles - Every vehicle shown on the map, as `[lat, lon]`.
 * @returns The box to fit the map to.
 */
export function nearbyFrame(
  here: readonly [number, number],
  accuracyM: number,
  vehicles: readonly (readonly [number, number])[],
): LatLonBox {
  let radius: number;
  if (accuracyM > ROUGH_FIX_M) {
    radius = Math.min(accuracyM, MAX_ROUGH_RADIUS_M);
  } else {
    const near = vehicles
      .map((v) => metresBetween(here, v))
      .filter((d) => d <= MAX_REACH_M)
      .sort((a, b) => a - b)
      .slice(0, NEAREST);
    radius = Math.max(MIN_RADIUS_M, accuracyM, near.at(-1) ?? 0);
  }
  const dLat = radius / M_PER_DEG;
  const dLon = radius / (M_PER_DEG * Math.cos((here[0] * Math.PI) / 180));
  return [
    [here[0] - dLat, here[1] - dLon],
    [here[0] + dLat, here[1] + dLon],
  ];
}
