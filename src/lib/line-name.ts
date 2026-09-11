// src/lib/line-name.ts
/**
 * @description Human-readable names for Auckland's train lines. AT's GTFS feed
 * sets `route_long_name` to the bare code for every train route ("STH", "EAST"),
 * so the schedule offers nothing to display beyond the code itself. The City Rail
 * Link network that starts on 13 September 2026 renames the lines to codes that
 * read as even less ("S-C", "E-W", "O-W"), so both networks are mapped here.
 */

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

/**
 * The published name for a train line, for display alongside its code.
 * @param mode - Route mode; only "TRAIN" resolves, so a bus route sharing a code can't match.
 * @param shortName - The route's short name (its line code).
 * @returns The line's name, or null when the mode isn't rail or the code is unknown.
 */
export function lineName(mode: string, shortName: string | null | undefined): string | null {
  if (mode !== "TRAIN" || !shortName) return null;
  return LINE_NAMES[shortName.toUpperCase()] ?? null;
}
