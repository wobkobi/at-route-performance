// src/lib/trip/punctuality.ts
// AT's trip measures, judged one trip at a time. AT calls a trip punctual when it leaves its
// first stop between 1 min early and 5 min late and reaches its last stop no more than 5 min
// late, and reliable when it leaves its first stop between 1 min early and 10 min late. Both
// are shares of trips, not of arrivals, so they sit apart from the site's own on-time window.

/** The earliest a departure can be and still count for either measure. */
export const DEPART_EARLY_SEC = 60;
/** The latest a departure can be and still count as punctual. */
export const PUNCTUAL_DEPART_LATE_SEC = 300;
/** The latest the last-stop arrival can be and still count as punctual. */
export const PUNCTUAL_ARRIVE_LATE_SEC = 300;
/** The latest a departure can be and still count as reliable. */
export const RELIABLE_DEPART_LATE_SEC = 600;

/** One recorded visit to a trip's opening or last stop. */
export interface EndReading {
  stopId: string;
  /** Scheduled time, epoch ms; orders two visits to the same stop. */
  scheduledMs: number;
  /** Signed deviation, seconds (negative early). */
  deviationSec: number;
}

/** A trip's opening stops (in order, last stop excluded) and its last stop. */
export interface TripEnds {
  startStopIds: readonly string[];
  lastStopId: string;
}

/** How one trip measured up; null where the readings cannot tell. */
export interface TripVerdict {
  /** Departure inside the reliable window, or null with no departure read. */
  reliable: boolean | null;
  /** Departure and arrival both inside the punctual window, or null missing either. */
  punctual: boolean | null;
}

/**
 * The reading that stands for the trip's departure: the first opening stop that was read, so a
 * departure the poll missed is taken from the next stop or the one after. On a loop the first
 * stop is also the last, and a lone reading there could be either visit, so it counts only
 * when both visits were read (the earlier is the departure).
 * @param readings - The trip's readings at its ends.
 * @param ends - The trip's opening and last stops.
 * @returns The departure reading, or null when no opening stop was read.
 */
export function departureReading(
  readings: readonly EndReading[],
  ends: TripEnds,
): EndReading | null {
  for (const stopId of ends.startStopIds) {
    const at = readings.filter((r) => r.stopId === stopId);
    const needed = stopId === ends.lastStopId ? 2 : 1;
    if (at.length >= needed) {
      return at.reduce((a, b) => (b.scheduledMs < a.scheduledMs ? b : a));
    }
  }
  return null;
}

/**
 * The reading that stands for the trip's arrival: the latest visit to the last stop scheduled
 * after the departure, which keeps a loop's departure from also serving as its arrival.
 * @param readings - The trip's readings at its ends.
 * @param ends - The trip's opening and last stops.
 * @param departure - The departure reading.
 * @returns The arrival reading, or null when the last stop was not read after leaving.
 */
export function arrivalReading(
  readings: readonly EndReading[],
  ends: TripEnds,
  departure: EndReading,
): EndReading | null {
  const at = readings.filter(
    (r) => r.stopId === ends.lastStopId && r.scheduledMs > departure.scheduledMs,
  );
  return at.length > 0 ? at.reduce((a, b) => (b.scheduledMs > a.scheduledMs ? b : a)) : null;
}

/**
 * Judge one trip AT's way.
 * @param readings - The trip's readings at its ends (others are ignored).
 * @param ends - The trip's opening and last stops.
 * @returns Whether it was reliable and punctual, each null when it cannot be told.
 */
export function judgeTrip(readings: readonly EndReading[], ends: TripEnds): TripVerdict {
  const dep = departureReading(readings, ends);
  if (!dep) return { reliable: null, punctual: null };
  /**
   * Whether the departure falls between 1 min early and the given lateness.
   * @param lateSec - The window's late edge.
   * @returns True inside the window.
   */
  const leftInWindow = (lateSec: number): boolean =>
    dep.deviationSec >= -DEPART_EARLY_SEC && dep.deviationSec <= lateSec;
  const arr = arrivalReading(readings, ends, dep);
  return {
    reliable: leftInWindow(RELIABLE_DEPART_LATE_SEC),
    punctual: arr
      ? leftInWindow(PUNCTUAL_DEPART_LATE_SEC) && arr.deviationSec <= PUNCTUAL_ARRIVE_LATE_SEC
      : null,
  };
}

/** One route's trip tallies for a day. */
export interface PunctualityCounts {
  /** Trips with a departure read: the reliable measure's judged trips. */
  departed: number;
  reliable: number;
  /** Trips with both a departure and an arrival read: the punctual measure's judged trips. */
  timed: number;
  punctual: number;
  /** Trips that never ran or were cut short; each fails both measures. */
  cancelled: number;
}

/**
 * An empty tally.
 * @returns Zero counts.
 */
export function emptyCounts(): PunctualityCounts {
  return { departed: 0, reliable: 0, timed: 0, punctual: 0, cancelled: 0 };
}

/**
 * Add one trip's verdict to a tally.
 * @param counts - The tally, changed in place.
 * @param verdict - The trip's verdict.
 */
export function addVerdict(counts: PunctualityCounts, verdict: TripVerdict): void {
  if (verdict.reliable !== null) {
    counts.departed++;
    if (verdict.reliable) counts.reliable++;
  }
  if (verdict.punctual !== null) {
    counts.timed++;
    if (verdict.punctual) counts.punctual++;
  }
}

/**
 * The share of trips that were punctual, cancelled trips counted as failures.
 * @param c - The tally.
 * @returns A percentage, or null with no trip judged.
 */
export function punctualPct(c: PunctualityCounts): number | null {
  const of = c.timed + c.cancelled;
  return of > 0 ? (100 * c.punctual) / of : null;
}

/**
 * The share of trips that were reliable, cancelled trips counted as failures.
 * @param c - The tally.
 * @returns A percentage, or null with no trip judged.
 */
export function reliablePct(c: PunctualityCounts): number | null {
  const of = c.departed + c.cancelled;
  return of > 0 ? (100 * c.reliable) / of : null;
}
