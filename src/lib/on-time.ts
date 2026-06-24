// src/lib/on-time.ts
//
// This project's on-time window is asymmetric and mode-specific:
//   Bus / Train: on time from 1 minute early to 5 minutes late.
//   Ferry:       on time within 5 minutes either side.
// The late side (5 min) is uniform across modes; only the early tolerance
// differs. This module is the single source of truth, shared by the Mongo
// aggregations (the on-time %) and the client banding (dot/ring/label colours),
// so it must stay free of server-only imports (e.g. Prisma).

/** Late tolerance in seconds: a service up to this late still counts on time. */
export const ON_TIME_LATE_SEC = 5 * 60;

/**
 * Early tolerance in seconds, by mode. Buses/trains hold at timepoints (1 min);
 * ferries get the full 5 minutes. Unknown modes fall back to the bus rule.
 */
export const EARLY_TOLERANCE_SEC: Record<string, number> = {
  BUS: 60,
  TRAIN: 60,
  FERRY: ON_TIME_LATE_SEC,
};

/** Bus/train early tolerance, reused by the Mongo fragments below. */
const BUS_EARLY_SEC = 60;

/**
 * Early tolerance (seconds) for a mode.
 * @param mode - Route mode ("BUS" | "TRAIN" | "FERRY").
 * @returns Seconds early a service may run and still count on time.
 */
export function earlyToleranceFor(mode: string): number {
  return EARLY_TOLERANCE_SEC[mode] ?? BUS_EARLY_SEC;
}

/**
 * Whether a signed deviation is on time for the given mode (negative early,
 * positive late).
 * @param deviationSec - Signed deviation in seconds.
 * @param mode - Route mode.
 * @returns True when within the mode's early..late on-time window.
 */
export function isOnTime(deviationSec: number, mode: string): boolean {
  return deviationSec <= ON_TIME_LATE_SEC && deviationSec >= -earlyToleranceFor(mode);
}

/** How a stop/trip/route reads against the on-time window. */
export type DelayBand = "early" | "ontime" | "late";

/**
 * Classify a signed deviation as early / on time / late for the given mode.
 * @param deviationSec - Signed deviation in seconds.
 * @param mode - Route mode.
 * @returns The band the deviation falls in.
 */
export function delayBand(deviationSec: number, mode: string): DelayBand {
  // Round first so the colour matches the rounded, displayed delay (e.g. 300.3s
  // shows "on time" and must get the on-time colour, not a late/red dot).
  const d = Math.round(deviationSec);
  if (d > ON_TIME_LATE_SEC) return "late";
  if (d < -earlyToleranceFor(mode)) return "early";
  return "ontime";
}

// --- Mongo aggregation fragments -------------------------------------------
// All reference the raw `deviationSec` field; the per-event/mode variants also
// reference a joined `route.mode`. They return plain objects for $runCommandRaw.

/**
 * Two `$sum` accumulators for the on-time count under each rule, for pipelines
 * that learn a group's mode only after a later `$lookup` (group by routeId, then
 * pick with {@link pickOnTimeByRouteMode}).
 * @returns `{ on_time_strict, on_time_ferry }` accumulator expressions.
 */
export function onTimeTwoCounts(): { on_time_strict: object; on_time_ferry: object } {
  return {
    on_time_strict: {
      $sum: {
        $cond: [
          {
            $and: [
              { $gte: ["$deviationSec", -BUS_EARLY_SEC] },
              { $lte: ["$deviationSec", ON_TIME_LATE_SEC] },
            ],
          },
          1,
          0,
        ],
      },
    },
    on_time_ferry: {
      $sum: {
        $cond: [
          {
            $and: [
              { $gte: ["$deviationSec", -ON_TIME_LATE_SEC] },
              { $lte: ["$deviationSec", ON_TIME_LATE_SEC] },
            ],
          },
          1,
          0,
        ],
      },
    },
  };
}

/** Pick the right on-time count once the group's `route.mode` is known. */
export const pickOnTimeByRouteMode = {
  $cond: [{ $eq: ["$route.mode", "FERRY"] }, "$on_time_ferry", "$on_time_strict"],
};

/**
 * A `$sum` accumulator counting events that ran late (beyond the 5-minute late
 * bound). Mode-independent, so it needs no later mode pick.
 * @returns A `$sum` of 1/0 per event.
 */
export function lateSum(): object {
  return { $sum: { $cond: [{ $gt: ["$deviationSec", ON_TIME_LATE_SEC] }, 1, 0] } };
}

/**
 * Two `$sum` accumulators for the early count under each rule, for pipelines that
 * learn a group's mode only after a later `$lookup` (pick with
 * {@link pickEarlyByRouteMode}). Early = ahead of the mode's early tolerance.
 * @returns `{ early_strict, early_ferry }` accumulator expressions.
 */
export function earlyTwoCounts(): { early_strict: object; early_ferry: object } {
  return {
    early_strict: { $sum: { $cond: [{ $lt: ["$deviationSec", -BUS_EARLY_SEC] }, 1, 0] } },
    early_ferry: { $sum: { $cond: [{ $lt: ["$deviationSec", -ON_TIME_LATE_SEC] }, 1, 0] } },
  };
}

/** Pick the right early count once the group's `route.mode` is known. */
export const pickEarlyByRouteMode = {
  $cond: [{ $eq: ["$route.mode", "FERRY"] }, "$early_ferry", "$early_strict"],
};

/**
 * A single early `$sum` accumulator for a known, fixed mode (single-route
 * pipelines that already resolved the route's mode in JS).
 * @param mode - The route's mode.
 * @returns A `$sum` of 1/0 per event ahead of that mode's early tolerance.
 */
export function earlySingleModeSum(mode: string): object {
  const early = earlyToleranceFor(mode);
  return { $sum: { $cond: [{ $lt: ["$deviationSec", -early] }, 1, 0] } };
}

/**
 * A single on-time `$sum` accumulator for pipelines where each event already
 * carries `route.mode` (the `$lookup` precedes the `$group`).
 * @returns A `$sum` of 1/0 per event, using the mode's early tolerance.
 */
export function onTimePerEventSum(): object {
  return {
    $sum: {
      $cond: [
        {
          $and: [
            { $lte: ["$deviationSec", ON_TIME_LATE_SEC] },
            {
              $gte: [
                "$deviationSec",
                { $cond: [{ $eq: ["$route.mode", "FERRY"] }, -ON_TIME_LATE_SEC, -BUS_EARLY_SEC] },
              ],
            },
          ],
        },
        1,
        0,
      ],
    },
  };
}

/**
 * A single on-time `$sum` accumulator for a known, fixed mode (single-route
 * pipelines that already resolved the route's mode in JS).
 * @param mode - The route's mode.
 * @returns A `$sum` of 1/0 per event using that mode's window.
 */
export function onTimeSingleModeSum(mode: string): object {
  const early = earlyToleranceFor(mode);
  return {
    $sum: {
      $cond: [
        {
          $and: [
            { $gte: ["$deviationSec", -early] },
            { $lte: ["$deviationSec", ON_TIME_LATE_SEC] },
          ],
        },
        1,
        0,
      ],
    },
  };
}
