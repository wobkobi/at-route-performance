// src/lib/station-siblings.ts
// Cross-links between the parents AT uses for one place. `station.ts` collapses
// a parent's platforms into a single stop and deliberately stops there: two
// parents stay two places, because joining them could only be done on their
// name, and AT renames stations (Britomart > Waitemata, Mount Eden >
// Maungawhau), so a name-keyed merge forks a place's history the day a rename
// lands. Auckland's interchanges are modelled as two or more parents all the
// same - Manukau is a bus station, a station and a train station - so a reader
// on the bus page has no way to reach the trains.
//
// The answer here is a link rather than a merge. A wrong link costs a reader one
// click; a wrong merge would weld two places' figures together and break every
// shared id. So this is allowed to be approximate where `station.ts` is not.

/**
 * How far apart two parents may sit and still be called one place, in metres.
 *
 * Measured over all 144 parents AT publishes (24 September 2026): of the 25
 * places holding more than one parent, every genuine pair sits within 391 m and
 * the next gap up is 973 m. So 400 m falls in open space rather than being tuned
 * to a boundary case. The one pair it excludes is the right one: Otahuhu's bus
 * and rail parents are 55 m apart, while a third parent AT also calls "Otahuhu"
 * is a pair of poles 998 m up the road, which shares the name without being the
 * interchange.
 */
export const SIBLING_MAX_METRES = 400;

/**
 * The facility words AT ends a station name with. Stripping one leaves the place
 * itself, which is what two parents of one interchange have in common - "Manukau
 * Bus Station" and "Manukau Train Station" are both Manukau. Longest first, so
 * "Bus Station" is taken before "Station" can match its tail.
 */
const FACILITY_RE =
  /\s+(?:Train Station|Bus Station|Bus Interchange|Ferry Terminal|Interchange|Station|Terminal|Wharf)$/i;

/** Metres per degree of latitude; the same local flat projection `off-route.ts` measures on. */
const M_PER_DEG = 111_320;

/** One of AT's parent stations, as the sibling rule needs to see it. */
export interface StationPlace {
  /** Canonical station id, the `station:` form a link carries. */
  id: string;
  /** The place's name in AT's own words, platform code already removed. */
  name: string;
  lat: number;
  lon: number;
  /** How many platforms the parent holds, which settles a name several parents share. */
  platforms: number;
}

/** A link from one parent's page to another parent of the same place. */
export interface StationSibling {
  id: string;
  name: string;
}

/** Every other parent of one place, with the shared place name to introduce them. */
export interface StationSiblings {
  /** The place both names have in common, e.g. "Otahuhu". */
  place: string;
  siblings: StationSibling[];
}

/**
 * The place a station name belongs to: its name with the facility word removed.
 * A name carrying no facility word is already the place ("Onehunga", "St Lukes").
 * @param name - A station's display name.
 * @returns The place name.
 */
export function placeOf(name: string): string {
  return name.replace(FACILITY_RE, "").trim();
}

/**
 * Metres between two points, on the same local flat projection `off-route.ts`
 * measures on (ample at city scale, and this only decides a 400 m question).
 * @param aLat - First point's latitude.
 * @param aLon - First point's longitude.
 * @param bLat - Second point's latitude.
 * @param bLon - Second point's longitude.
 * @returns The distance in metres.
 */
function metresBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const north = (aLat - bLat) * M_PER_DEG;
  const east = (aLon - bLon) * M_PER_DEG * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  return Math.hypot(north, east);
}

/**
 * Work out, for every parent, which other parents to link as the same place.
 * Two parents are siblings when they share a place name, sit within
 * {@link SIBLING_MAX_METRES}, and **differ in name** - the last condition being
 * the one that makes the links usable rather than the one that makes them
 * correct. AT gives four separate parents the name "Maungawhau Station" and
 * three "Glen Innes Station", so linking every near neighbour would print the
 * page's own title back at the reader several times over with nothing to choose
 * between. A link is only worth offering when its label says where it goes.
 *
 * Where several parents do share one name, the link goes to the largest by
 * platform count, which in every measured case is the main facility rather than
 * a pole beside it. Equal counts break on the id so the link cannot move between
 * requests.
 * @param places - Every parent station AT publishes.
 * @returns Each parent's siblings, keyed by station id; parents with none are absent.
 */
export function siblingsByStation(places: readonly StationPlace[]): Map<string, StationSiblings> {
  const byPlace = new Map<string, StationPlace[]>();
  for (const p of places) {
    const key = placeOf(p.name).toLowerCase();
    if (key === "") continue;
    const group = byPlace.get(key);
    if (group) group.push(p);
    else byPlace.set(key, [p]);
  }

  const out = new Map<string, StationSiblings>();
  for (const group of byPlace.values()) {
    if (group.length < 2) continue;
    for (const self of group) {
      // One candidate per distinct name: the largest parent carrying it.
      const best = new Map<string, StationPlace>();
      for (const other of group) {
        if (other.id === self.id || other.name === self.name) continue;
        if (metresBetween(self.lat, self.lon, other.lat, other.lon) > SIBLING_MAX_METRES) continue;
        const held = best.get(other.name);
        if (
          !held ||
          other.platforms > held.platforms ||
          (other.platforms === held.platforms && other.id.localeCompare(held.id) < 0)
        ) {
          best.set(other.name, other);
        }
      }
      if (best.size === 0) continue;
      out.set(self.id, {
        place: placeOf(self.name),
        siblings: [...best.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((s) => ({ id: s.id, name: s.name })),
      });
    }
  }
  return out;
}
