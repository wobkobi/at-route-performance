// src/lib/route/line-name.ts
// Human-readable names for Auckland's train lines and branded bus services.
// AT's GTFS feed sets `route_long_name` to the bare code for every one of them
// ("STH", "CTY"), so the schedule offers nothing to display or search beyond the
// code itself. The City Rail Link network that starts on 13 September 2026
// renames the lines to codes that read as even less ("S-C", "E-W", "O-W"), so
// both networks are mapped here.

/**
 * Train-line code to its published name. Codes are AT's `route_short_name`.
 *
 * The post-CRL codes are published as "S-C"/"E-W"/"O-W"; the unhyphenated forms
 * are listed too, because AT has not yet published the GTFS `route_id`s and its
 * existing ids are `<short name>-<version>` ("STH-201"), which a hyphenated code
 * may well be flattened to avoid. No existing AT route uses either form, so the
 * extra keys cannot collide.
 */
const LINE_NAMES: Record<string, string> = {
  // Network until 13 September 2026.
  STH: "Southern Line",
  EAST: "Eastern Line",
  WEST: "Western Line",
  ONE: "Onehunga Line",
  PUK: "Pukekohe Shuttle",
  // City Rail Link network, from 13 September 2026.
  "S-C": "South City Line",
  SC: "South City Line",
  "E-W": "East West Line",
  EW: "East West Line",
  "O-W": "Onehunga West Line",
  OW: "Onehunga West Line",
  // Waikato regional service to Hamilton, in AT's feed as a train route.
  HUIA: "Te Huia",
};

/** Branded bus service code to its published name, written as AT brands it. */
const BUS_NAMES: Record<string, string> = {
  CTY: "CityLink",
  INN: "InnerLink",
  OUT: "OuterLink",
  TMK: "TāmakiLink",
  AIR: "AirportLink",
  NX1: "Northern Express",
  NX2: "Northern Express",
  WX1: "Western Express",
};

/**
 * The published name for a train line or branded bus service, for display
 * alongside its code and for search.
 * @param mode - Route mode; each mode has its own names, so a route of another
 *   mode sharing a code cannot match.
 * @param shortName - The route's short name (its code).
 * @returns The name, or null when the code has none for that mode.
 */
export function lineName(mode: string, shortName: string | null | undefined): string | null {
  if (!shortName) return null;
  const names = mode === "TRAIN" ? LINE_NAMES : mode === "BUS" ? BUS_NAMES : null;
  return names?.[shortName.toUpperCase()] ?? null;
}
