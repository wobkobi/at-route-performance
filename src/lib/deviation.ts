// src/lib/deviation.ts
// Separating real schedule deviation from GTFS-RT feed noise.
//
// The noise that matters is the "ghost": AT reuses a `trip_id` against a later
// vehicle block, so a vehicle running ~1 h off its slot reports that same offset
// at every stop of the trip, and a couple of those float a quiet stop to the top
// of the worst-stops board.
//
// A ghost is told apart by its *shape*, not its size. It sits at a near-constant
// offset from the run's own level, while a real delay accumulates along the trip.
// Classifying on that shape (runDeviationLevel + isGhostDeviation)
// is what lets genuinely catastrophic delays survive - a magnitude cap cannot
// distinguish a ghost from a service that really did run an hour late, and this
// site exists to show the second kind.
//
// A wide bound still guards the reads that cannot wait for classification: the
// current service day, and a completed day whose nightly pass has not run yet.
// Once every day in a window is classified the bound comes off.
import type { Prisma } from "@prisma/client";

/**
 * How far from its run's own level an observation may sit before it reads as a
 * ghost re-report rather than part of the run. AT's block reuse puts ghosts a
 * full vehicle cycle away, so they clear this comfortably.
 */
export const GHOST_GAP_SEC = 45 * 60;

/**
 * Widest deviation accepted from rows the nightly ghost pass has not classified
 * yet: the service day in progress, and a completed day whose aggregate has not
 * run. Set well beyond any real delay so those boards still show the extremes;
 * classification does the real work, and classified windows carry no bound.
 */
export const UNCLASSIFIED_LIMIT_SEC = 3 * 60 * 60;

/** One observation of a trip's schedule deviation, for ghost classification. */
export interface TripObservation {
  /**
   * Groups observations that describe the same physical arrival, so one place
   * cannot pull the level twice - a station id for train platforms, else the
   * stop id (see `stationId` in station.ts).
   */
  stationId: string;
  /** Signed deviation in seconds (negative early, positive late). */
  deviationSec: number;
}

/**
 * The deviation level a trip's real run sat at.
 *
 * Each place contributes only its observation nearest its own schedule: where a
 * stop carries both the real arrival and a ghost re-report, that picks the real
 * one. The median of those resists the case where ghosts still outnumber real
 * readings.
 * @param observations - Every observation recorded for one trip on one day.
 * @returns The run's median deviation in seconds, or null when there are none.
 */
export function runDeviationLevel(observations: TripObservation[]): number | null {
  const bestByPlace = new Map<string, number>();
  for (const o of observations) {
    const cur = bestByPlace.get(o.stationId);
    if (cur === undefined || Math.abs(o.deviationSec) < Math.abs(cur)) {
      bestByPlace.set(o.stationId, o.deviationSec);
    }
  }
  return medianDeviation([...bestByPlace.values()]);
}

/**
 * Median of a set of signed deviations. Split out so the nightly pass, whose
 * aggregation already reduced each place to one reading, shares the same
 * definition of a run's level as the in-memory path.
 * @param deviations - Signed deviations, one per place.
 * @returns The median, or null when the set is empty.
 */
export function medianDeviation(deviations: number[]): number | null {
  if (deviations.length === 0) return null;
  const sorted = [...deviations].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/**
 * Whether an observation is a ghost re-report rather than part of its run.
 * @param deviationSec - The observation's signed deviation in seconds.
 * @param runLevel - The run's level from {@link runDeviationLevel}.
 * @returns True when the observation sits more than {@link GHOST_GAP_SEC} off the run.
 */
export function isGhostDeviation(deviationSec: number, runLevel: number): boolean {
  return Math.abs(deviationSec - runLevel) > GHOST_GAP_SEC;
}

/**
 * `source` marking a row captured under `?loose=1`, where the feed carried no
 * delay at all. Those rows store `deviationSec: 0`, so counting them would read
 * as a perfectly on-time arrival that was never actually observed.
 */
export const NO_DELAY_SOURCE = "AT_GTFSRT_NO_DELAY";

/**
 * Mongo `$match` fragment keeping only observations that count towards the
 * stats: everything the nightly pass did not flag as a ghost, minus the
 * no-delay rows. For a window the pass has not classified yet, the
 * {@link UNCLASSIFIED_LIMIT_SEC} magnitude guard stands in for the missing
 * flags; once every day in the window is classified the guard comes off, so a
 * service that really did run three hours late is counted rather than capped.
 *
 * Spread into a pipeline `$match` alongside the date and route filters. Rows are
 * never deleted for this - a misclassification stays recoverable, and the raw
 * archive is the point of the project.
 * @param classified - Whether every day in the window has been through the ghost pass.
 * @returns The `$match` fragment.
 */
export function realDeviationMatchFor(classified: boolean): Prisma.InputJsonObject {
  return {
    ghost: { $ne: true },
    source: { $ne: NO_DELAY_SOURCE },
    ...(classified
      ? {}
      : { deviationSec: { $gte: -UNCLASSIFIED_LIMIT_SEC, $lte: UNCLASSIFIED_LIMIT_SEC } }),
  };
}

/**
 * Expression form of {@link realDeviationMatchFor}, for `$cond` and `$filter`
 * guards inside a `$group` - pipelines that must count every row but average
 * only the real ones.
 * @param classified - Whether every day in the window has been through the ghost pass.
 * @returns The boolean aggregation expression.
 */
export function realDeviationExprFor(classified: boolean): Prisma.InputJsonObject {
  return {
    $and: [
      { $ne: ["$ghost", true] },
      { $ne: ["$source", NO_DELAY_SOURCE] },
      ...(classified
        ? []
        : [
            { $gte: ["$deviationSec", -UNCLASSIFIED_LIMIT_SEC] },
            { $lte: ["$deviationSec", UNCLASSIFIED_LIMIT_SEC] },
          ]),
    ],
  };
}
