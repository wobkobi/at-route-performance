// src/lib/station.ts
/**
 * @description Collapse Auckland train-station platform stops into one logical
 * station. AT exposes each platform as its own GTFS stop ("Newmarket Train
 * Station 1/2/4") and bakes the platform number into trip headsigns, so a line
 * otherwise splits into near-duplicate variants and one station shows up as
 * several stops; these helpers normalise platforms to a single stop for the
 * diagram, map and stats. Only train platforms are affected.
 *
 * The station's identity is AT's own `parent_station` id wherever the feed
 * supplies it, and only falls back to the station's name when it doesn't. AT
 * renames stations (Britomart > Waitemata, Mount Eden > Maungawhau, and the
 * City Rail Link adds more), and a name-keyed id would change with them -
 * forking a station's history and breaking every shared link.
 */

/** Matches a platform-numbered train-station name, capturing the station part. */
const PLATFORM_RE = /^(.*\bTrain Station)\s+\d+\s*$/i;

/** Matches an unnumbered train-station name; a platform only when AT gives it a platform code. */
const STATION_RE = /\bTrain Station\s*$/i;

/** Prefix marking a canonical station id, distinguishing it from a real GTFS stop id. */
export const STATION_PREFIX = "station:";

/** AT's grouping fields for a stop, as stored on the Stop record. */
export interface StationParts {
  /** The `parent_station` id AT assigns to a platform or pole. */
  parentStation?: string | null;
  /** The `platform_code` label AT assigns within a station ("1", "2B", "A"). */
  platformCode?: string | null;
}

/**
 * Whether a stop is one platform of a train station.
 *
 * Numbered names ("Newmarket Train Station 2") are platforms outright. An
 * unnumbered name is one only when AT also gives it a platform code - which is
 * how single-platform stations appear (Onehunga is "Onehunga Train Station"
 * with `platform_code: "1"`, and so never collapsed while every other station
 * did).
 * @param name - The stop's display name.
 * @param parts - AT's grouping fields for the stop, when known.
 * @returns True when the stop is a train-station platform.
 */
export function isPlatformStop(name: string, parts?: StationParts): boolean {
  if (PLATFORM_RE.test(name)) return true;
  return Boolean(parts?.platformCode) && STATION_RE.test(name);
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
 * Canonical id for a stop: train platforms collapse to one id per station, so
 * the diagram, map, and per-stop stats merge them. Every other stop keeps its
 * real id, so same-named bus stops are never merged.
 *
 * The id is built from AT's `parent_station` when the feed supplies it, so it
 * survives a station rename; the name-derived form is the fallback for rows
 * read before the parent fields were stored (see {@link legacyStationId}).
 * @param stopId - The stop's real GTFS id.
 * @param name - The stop's display name.
 * @param parts - AT's grouping fields for the stop, when known.
 * @returns A station id for platforms, else the original `stopId`.
 */
export function stationId(stopId: string, name: string, parts?: StationParts): string {
  if (!isPlatformStop(name, parts)) return stopId;
  return parts?.parentStation ? `${STATION_PREFIX}${parts.parentStation}` : legacyStationId(name);
}

/**
 * The name-derived station id used before AT's `parent_station` was stored.
 * Still minted as a fallback, and still resolved so old links keep working.
 * @param name - The stop's display name (numbered or not).
 * @returns `station:<lowercased station name>`.
 */
export function legacyStationId(name: string): string {
  return `${STATION_PREFIX}${stationName(name).toLowerCase()}`;
}

/**
 * Whether a station id is the old name-derived form rather than a parent id.
 * AT stop ids are `<code>-<hex>` (e.g. "605-b9605c8e"), so a station id
 * containing a space is a station name and predates the parent-keyed form.
 * @param id - A canonical id beginning with {@link STATION_PREFIX}.
 * @returns True when the id encodes a station name.
 */
export function isLegacyStationId(id: string): boolean {
  return id.startsWith(STATION_PREFIX) && id.includes(" ");
}

// --- Mongo aggregation fragments -------------------------------------------
// For pipelines that `$lookup` the Stop collection as `stop`, mirroring the
// `$match` fragment deviation.ts exposes.

/** `$project` fields carrying AT's station grouping from a joined `stop` document. */
export const stationProjection = {
  parent_station: "$stop.parentStation",
  platform_code: "$stop.platformCode",
} as const;

/** A projected row carrying AT's station grouping (see {@link stationProjection}). */
export interface StationRow {
  parent_station?: string | null;
  platform_code?: string | null;
}

/**
 * Read a projected row's station grouping in the shape {@link stationId} takes.
 * @param row - A row projected with {@link stationProjection}.
 * @returns The row's parent station and platform code.
 */
export function stationPartsOf(row: StationRow): StationParts {
  return { parentStation: row.parent_station, platformCode: row.platform_code };
}

/**
 * Words that join place names in a headsign. A number straight after one of
 * these belongs to whatever follows ("To 2 Bridges"), not to a platform.
 */
const HEADSIGN_CONNECTIVES = new Set(["to", "via", "from", "at", "and", "&", "-"]);

/**
 * Strip platform numbers from a train trip headsign so direction labels read
 * cleanly once platform variants are merged ("Swanson 1 To Brit 2 Via Newmarket 2"
 * > "Swanson To Brit Via Newmarket"). Only meaningful for trains; pass other
 * modes' headsigns through unchanged at the call site.
 *
 * A platform number is a short number directly after a place name, so only that
 * is dropped - stripping every standalone digit run also ate figures that were
 * part of a destination.
 * @param headsign - The raw GTFS trip headsign, or null.
 * @returns The headsign without station platform numbers, or null.
 */
export function normaliseHeadsign(headsign: string | null): string | null {
  if (!headsign) return headsign;
  const kept: string[] = [];
  for (const token of headsign.split(/\s+/)) {
    const prev = kept[kept.length - 1];
    const followsName =
      prev !== undefined && /\p{L}/u.test(prev) && !HEADSIGN_CONNECTIVES.has(prev.toLowerCase());
    if (/^\d{1,2}$/.test(token) && followsName) continue;
    kept.push(token);
  }
  return kept.join(" ").trim();
}
