// src/lib/train-consist.ts
// How many carriages a live train has. Auckland's trains are 3-car units run
// alone or coupled as 6 or 9 cars, and AT's vehicle feed reports every unit's
// position but attaches the trip to only one of them. The other units arrive
// with no trip, so a train's length is read off the trip-less units moving with it.

/** One train unit's reading from the vehicle feed. */
export interface TrainUnit {
  id: string;
  lat: number;
  lon: number;
  /** Speed in metres per second, or null when the feed names none. */
  speed: number | null;
  /** Compass heading in degrees, or null when the feed names none. */
  bearing: number | null;
  /** Position timestamp, epoch seconds, or null. */
  timestamp: number | null;
}

/** Carriages in one unit. */
export const CARS_PER_UNIT = 3;
/** Most units AT couples into one train (a 9-car). */
const MAX_UNITS = 3;
/**
 * Furthest a moving unit can sit from the unit next to it in the same train.
 * Observed spacing between coupled units' GPS points is 49-128m.
 */
const MOVING_LINK_M = 150;
/**
 * The same bound for a train standing still, tighter because a stopped train
 * cannot be told apart from a parked unit beside it by speed or heading.
 */
const STILL_LINK_M = 110;
/** Below this speed (m/s) a unit counts as standing still. */
const STILL_SPEED = 2;
/** Coupled units report speeds within about 0.5 m/s; this allows for lag. */
const MAX_SPEED_GAP = 2;
/** Coupled units report headings within about 15 degrees on a curve. */
const MAX_BEARING_GAP = 30;
/** Readings further apart in time than this are not compared. */
const MAX_TIME_GAP_S = 60;

/**
 * Ground distance between two readings in metres. An equirectangular
 * approximation, accurate to well under a metre over the few hundred metres
 * compared here.
 * @param a - First reading.
 * @param b - Second reading.
 * @returns Distance in metres.
 */
function metresBetween(a: TrainUnit, b: TrainUnit): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6_371_000;
}

/**
 * Whether two units read as one train: close enough, reported at about the same
 * time, and either both moving at the same speed and heading, or both standing
 * still close together.
 * @param a - A unit already in the train.
 * @param b - A trip-less unit that may be coupled to it.
 * @returns True when they move as one.
 */
function movesWith(a: TrainUnit, b: TrainUnit): boolean {
  if (a.timestamp != null && b.timestamp != null) {
    if (Math.abs(a.timestamp - b.timestamp) > MAX_TIME_GAP_S) return false;
  }
  const d = metresBetween(a, b);
  const aStill = (a.speed ?? 0) < STILL_SPEED;
  const bStill = (b.speed ?? 0) < STILL_SPEED;
  if (aStill && bStill) return d <= STILL_LINK_M;
  if (aStill !== bStill || d > MOVING_LINK_M) return false;
  if (Math.abs((a.speed ?? 0) - (b.speed ?? 0)) > MAX_SPEED_GAP) return false;
  if (a.bearing == null || b.bearing == null) return true;
  const turn = Math.abs(a.bearing - b.bearing) % 360;
  return Math.min(turn, 360 - turn) <= MAX_BEARING_GAP;
}

/**
 * Count the carriages of each train in service. Each trip-less unit joins at
 * most one train: the nearest pairings are taken first, so two trains passing
 * cannot share a unit. A unit links to the lead or to a unit already joined, so
 * the far unit of a 9-car, a full unit length beyond the middle one, still
 * counts.
 * @param leads - The units carrying a trip, one per train in service.
 * @param free - Train units reporting no trip (coupled, or parked).
 * @returns Lead unit id > carriages (3, 6 or 9).
 */
export function trainCars(leads: TrainUnit[], free: TrainUnit[]): Map<string, number> {
  const members = new Map(leads.map((l) => [l.id, [l]]));
  const unclaimed = new Set(free.map((f) => f.id));
  // Rounds rather than one pass, so a unit can join through one that joined
  // in the round before it.
  for (let round = 1; round < MAX_UNITS; round++) {
    const pairs: { leadId: string; unit: TrainUnit; d: number }[] = [];
    for (const [leadId, units] of members) {
      if (units.length >= MAX_UNITS) continue;
      for (const f of free) {
        if (!unclaimed.has(f.id)) continue;
        const near = units.filter((u) => movesWith(u, f));
        if (near.length === 0) continue;
        pairs.push({ leadId, unit: f, d: Math.min(...near.map((u) => metresBetween(u, f))) });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const grew = new Set<string>();
    for (const p of pairs) {
      if (!unclaimed.has(p.unit.id) || grew.has(p.leadId)) continue;
      unclaimed.delete(p.unit.id);
      members.get(p.leadId)?.push(p.unit);
      grew.add(p.leadId);
    }
    if (grew.size === 0) break;
  }
  return new Map([...members].map(([id, units]) => [id, units.length * CARS_PER_UNIT]));
}
