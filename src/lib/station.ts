// src/lib/station.ts
/**
 * @description Collapse Auckland train-station platform stops into one logical
 * station. AT exposes each platform as its own GTFS stop ("Newmarket Train
 * Station 1/2/4") and bakes the platform number into trip headsigns, so a line
 * otherwise splits into near-duplicate variants and one station shows up as
 * several stops; these helpers normalise platforms to a single stop for the
 * diagram, map and stats. Only platform-numbered train stops are affected.
 */

/** Matches a platform-numbered train-station name, capturing the station part. */
const PLATFORM_RE = /^(.*\bTrain Station)\s+\d+\s*$/i;

/**
 * Whether a stop name is a numbered train-station platform.
 * @param name - The stop's display name.
 * @returns True for "... Train Station N".
 */
export function isPlatformStop(name: string): boolean {
  return PLATFORM_RE.test(name);
}

/**
 * Drop the platform number from a train-station name; other names pass through.
 * @param name - The stop's display name.
 * @returns "Newmarket Train Station 2" > "Newmarket Train Station"; else unchanged.
 */
export function stationName(name: string): string {
  const m = PLATFORM_RE.exec(name);
  return m ? m[1] : name;
}

/**
 * Canonical id for a stop: train platforms collapse to one id per station (its
 * normalised name), so the diagram, map, and per-stop stats merge them. Every
 * other stop keeps its real id, so same-named bus stops are never merged.
 * @param stopId - The stop's real GTFS id.
 * @param name - The stop's display name.
 * @returns A station id for platforms, else the original `stopId`.
 */
export function stationId(stopId: string, name: string): string {
  return isPlatformStop(name) ? `station:${stationName(name).toLowerCase()}` : stopId;
}

/**
 * Strip platform numbers from a train trip headsign so direction labels read
 * cleanly once platform variants are merged ("Swanson 1 To Brit 2 Via Newmarket 2"
 * > "Swanson To Brit Via Newmarket"). Only meaningful for trains; pass other
 * modes' headsigns through unchanged at the call site.
 * @param headsign - The raw GTFS trip headsign, or null.
 * @returns The headsign without standalone platform digits, or null.
 */
export function normaliseHeadsign(headsign: string | null): string | null {
  if (!headsign) return headsign;
  return headsign
    .replace(/\s+\d+\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
