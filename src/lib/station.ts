// src/lib/station.ts
// Collapse the platforms of one place into a single logical stop. AT exposes
// every platform, bay and pier as its own GTFS stop ("Newmarket Train Station
// 1/2/4", "Bay 23 Manukau Bus Station", "Downtown Ferry Terminal Pier 1") and
// bakes the platform number into train headsigns, so a line otherwise splits
// into near-duplicate variants and one place shows up as several stops; these
// helpers normalise platforms to a single stop for the diagram, map and stats.
//
// The place's identity is AT's own `parent_station` id wherever the feed
// supplies it, and only falls back to the station's name when it doesn't. AT
// renames stations (Britomart > Waitemata, Mount Eden > Maungawhau, and the
// City Rail Link adds more), and a name-keyed id would change with them -
// forking a station's history and breaking every shared link. That is also why
// a place AT models as two parents stays two: Otahuhu is a bus "Otahuhu
// Station" and a rail "Otahuhu Train Station", and joining them would have to
// be done on the name, which is the thing that moves.

/** Matches a platform-numbered train-station name, capturing the station part. */
const PLATFORM_RE = /^(.*\bTrain Station)\s+\d+\s*$/i;

/** Matches an unnumbered train-station name; a platform only when AT gives it a platform code. */
const STATION_RE = /\bTrain Station\s*$/i;

/**
 * The words AT puts beside a platform code inside a stop's name. All four
 * shapes occur: "Bay 23 Manukau Bus Station", "Stop A Hibiscus Coast",
 * "Downtown Ferry Terminal Pier 1" and the bare "Newmarket Train Station 1".
 */
const CODE_LABELS = "Stop|Bay|Pier|Platform|Gate";

/**
 * Escape a platform code for use inside a regex. Codes are alphanumeric today
 * ("1", "2B", "A"), so this is insurance against a feed that widens them rather
 * than a case that occurs.
 * @param code - The raw platform code.
 * @returns The code with regex metacharacters escaped.
 */
function escapeCode(code: string): string {
  return code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
 * Whether a stop is one platform, bay or pier of a larger place.
 *
 * AT's own `parent_station` settles it wherever the feed supplies one, which is
 * every mode: rail platforms, the bays of a bus station and the piers of a ferry
 * terminal all carry it. The two name rules below are the fallback for rows read
 * before those fields were stored - a numbered name ("Newmarket Train Station 2")
 * is a platform outright, and an unnumbered one is a platform only when AT also
 * gives it a platform code, which is how single-platform stations appear
 * (Onehunga is "Onehunga Train Station" with `platform_code: "1"`).
 * @param name - The stop's display name.
 * @param parts - AT's grouping fields for the stop, when known.
 * @returns True when the stop is one platform of a parent place.
 */
export function isPlatformStop(name: string, parts?: StationParts): boolean {
  if (parts?.parentStation) return true;
  if (PLATFORM_RE.test(name)) return true;
  return Boolean(parts?.platformCode) && STATION_RE.test(name);
}

/**
 * Drop the platform label from a stop's name, leaving the place it belongs to.
 *
 * AT writes the platform code into the name itself, but in four different
 * shapes, so the code is removed rather than any one shape matched: it is the
 * one token the feed hands over verbatim, in `platform_code`. It appears as a
 * prefix with a label ("Bay 23 Manukau Bus Station", "Stop A Hibiscus Coast"),
 * as a suffix with one ("Downtown Ferry Terminal Pier 1") and as a bare suffix
 * ("Newmarket Train Station 1"). A name that does not contain its own code -
 * "Onehunga Train Station" with `platform_code: "1"` - passes through, which is
 * right: that is already the station's name.
 *
 * Only one end is stripped, the leading one first, so a place whose name both
 * begins and ends with its code cannot be eaten from both sides.
 * @param name - The stop's display name.
 * @param parts - AT's grouping fields for the stop, when known.
 * @returns The parent place's name, or the name unchanged.
 */
export function stationName(name: string, parts?: StationParts): string {
  const code = parts?.platformCode?.trim();
  if (code) {
    const c = escapeCode(code);
    const lead = new RegExp(`^(?:(?:${CODE_LABELS})\\s+)?${c}\\s+`, "i");
    const trail = new RegExp(`\\s+(?:(?:${CODE_LABELS})\\s+)?${c}$`, "i");
    const stripped = (lead.test(name) ? name.replace(lead, "") : name.replace(trail, "")).trim();
    if (stripped) return stripped;
  }
  return PLATFORM_RE.exec(name)?.[1] ?? name;
}

/**
 * How to label one platform within its own station: AT's platform code, carrying
 * the word AT put beside it. The inverse of {@link stationName}, which removes
 * exactly this - so "Bay 23 Manukau Bus Station" labels as "Bay 23", "Downtown
 * Ferry Terminal Pier 1" as "Pier 1", and "Newmarket Train Station 1", which AT
 * writes with no word at all, as the bare "1".
 *
 * The word is AT's own, in AT's casing, so a station names its platforms the way
 * its signs do and none is invented. All 383 platforms AT gives a parent also
 * carry a `platform_code`; the fallbacks are insurance against a feed that stops
 * doing so.
 * @param name - The stop's display name.
 * @param parts - AT's grouping fields for the stop, when known.
 * @returns The platform's label.
 */
export function platformLabelOf(name: string, parts?: StationParts): string {
  const code = parts?.platformCode?.trim();
  if (!code) return /\s(\d+)\s*$/.exec(name)?.[1] ?? name;
  const c = escapeCode(code);
  // Capture group 1 is AT's word for the platform, when the name puts one beside
  // the code; a bare code leaves it undefined.
  const word =
    new RegExp(`^(?:(${CODE_LABELS})\\s+)?${c}\\s`, "i").exec(name)?.[1] ??
    new RegExp(`\\s(?:(${CODE_LABELS})\\s+)?${c}\\s*$`, "i").exec(name)?.[1];
  return word ? `${word} ${code}` : code;
}

/**
 * The name to show for a parent place, chosen across all of its platforms.
 *
 * Two of AT's parents disagree with themselves - one holds both
 * "Stop F Newmarket Station" and "Stop C Westfield Newmarket" - so taking any
 * one platform's name would make the page's title depend on row order. The most
 * common name wins, and an even split is broken alphabetically so the title is
 * the same on every render.
 * @param platforms - The parent's platforms, each with its name and code.
 * @returns The place's name, or an empty string when given no platforms.
 */
export function stationNameOf(platforms: readonly (StationParts & { name: string })[]): string {
  const counts = new Map<string, number>();
  for (const p of platforms) {
    const n = stationName(p.name, p);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [n, c] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (c > bestCount) {
      best = n;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Canonical id for a stop: a parent place's platforms collapse to one id, so
 * the diagram, map and per-stop stats merge them. A stop AT gives no parent
 * keeps its real id, so same-named stops are never merged on their name.
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
