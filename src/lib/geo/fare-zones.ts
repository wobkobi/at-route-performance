// src/lib/geo/fare-zones.ts
// AT's fare zones by key and name, for the Routes page's fare zone filter and a
// stop's zone. Kept apart from the polygons (lib/geo/fare-zone-geo.ts) so the
// client-side filter can name the zones without shipping the boundaries.

import { isKeyOf, labelsByKey, type KeyedLabel } from "@/lib/collections";

/** A fare zone key. */
export type FareZoneKey =
  | "city"
  | "isthmus"
  | "lower-north-shore"
  | "east-coast-south-rodney"
  | "waitakere"
  | "northern-manukau"
  | "southern-manukau"
  | "waiheke"
  | "warkworth"
  | "aotea";

/** Every zone in display order (fare-zones.json keeps the same order), with AT's name for it. */
export const FARE_ZONES: readonly KeyedLabel<FareZoneKey>[] = [
  { key: "city", label: "City" },
  { key: "isthmus", label: "Isthmus" },
  { key: "lower-north-shore", label: "Lower North Shore" },
  { key: "east-coast-south-rodney", label: "East Coast / South Rodney" },
  { key: "waitakere", label: "Waitākere" },
  { key: "northern-manukau", label: "Northern Manukau" },
  { key: "southern-manukau", label: "Southern Manukau" },
  { key: "waiheke", label: "Waiheke" },
  { key: "warkworth", label: "Warkworth" },
  { key: "aotea", label: "Aotea" },
];

/** Zone key to its label. */
export const FARE_ZONE_LABEL = labelsByKey(FARE_ZONES);

/**
 * Whether a string is a zone key.
 * @param value - Candidate key, e.g. from a query param.
 * @returns True when it names a zone.
 */
export function isFareZoneKey(value: string): value is FareZoneKey {
  return isKeyOf(FARE_ZONES, value);
}
