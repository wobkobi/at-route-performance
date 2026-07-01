// src/lib/deviation.ts
/**
 * @description Plausibility bounds for schedule deviation that filter GTFS-RT
 * feed noise out of the stats. Two failure modes dominate: implausibly early
 * reports (buses hold at timepoints, so a service reported far ahead of schedule
 * is noise) and "ghosts" - AT reuses a trip_id against a later vehicle block, so
 * a vehicle running ~1 h off its slot reports as ~60 min late at every stop and
 * can float a quiet stop to the top of the worst-stops board. Capping early at
 * 20 min and late at the timeline's 45 min ghost gap keeps both out. Exposed as
 * a predicate (drop at ingest) and a Mongo `$match` fragment (exclude from
 * aggregates without deleting raw rows).
 */

/**
 * Largest plausible *early* running, in seconds. Buses on this network hold at
 * timepoints, so they cannot run far ahead of schedule; anything earlier than
 * this is GTFS-RT feed noise (e.g. a school run reported ~58 min early).
 */
export const MAX_EARLY_SEC = 20 * 60;

/**
 * Largest plausible *late* running, in seconds. Anything later is almost always
 * a "ghost": AT reuses a trip_id against a later vehicle block, so a vehicle
 * tracked ~1 hour off its scheduled slot reports as ~60 min late at every stop.
 * Capping at the timeline's ghost gap (45 min) keeps those re-reports out of
 * every aggregate (otherwise a couple of them float a quiet stop to the top of
 * the worst-stops board); genuine services on this network are rarely this late.
 */
export const MAX_LATE_SEC = 45 * 60;

/**
 * Whether a signed schedule deviation is physically plausible (negative early,
 * positive late). Used to drop feed noise at ingest and to exclude it from stats.
 * @param sec - Signed deviation in seconds.
 * @returns True when the deviation is within the plausible early/late bounds.
 */
export function isPlausibleDeviation(sec: number): boolean {
  return sec >= -MAX_EARLY_SEC && sec <= MAX_LATE_SEC;
}

/**
 * Mongo `$match` fragment keeping only plausibly-deviating events. Spread into a
 * pipeline `$match` (alongside the date/route filters) so existing feed noise is
 * excluded from every aggregation without deleting the raw rows.
 */
export const plausibleDeviationMatch = {
  deviationSec: { $gte: -MAX_EARLY_SEC, $lte: MAX_LATE_SEC },
} as const;
