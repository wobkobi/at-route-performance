// src/lib/cancellation.ts
// What a cancellation flag meant for one trip. AT's realtime feed flags a trip
// CANCELED, and ingest keeps the first poll that saw the flag (`detectedAt`).
// Once flagged, the trip's updates carry no stop times, so nothing more is
// recorded - unless AT reverses the cancellation and the trip carries on, which
// it does. Comparing the trip's recorded arrivals with the flag separates never
// ran, cut short, and reinstated.
//
// The feed sends one stop time update per trip: the next stop, with a predicted
// arrival. So a trip that stops reporting at the flag can leave one predicted
// arrival beyond it that the vehicle never made, and a trip that kept running
// leaves a string of them. Across four days in September 2026 the arrivals
// after a flag numbered 0, 1 or at least 6 for every flagged trip but one.

/**
 * How a flagged trip played out:
 * - `before`: no arrival before the flag, so it never ran (at most a prediction for its first stop).
 * - `mid-trip`: arrivals up to the flag and no more than a leftover prediction after, so it was cut short.
 * - `ran`: a run of arrivals after the flag, so the cancellation was reversed.
 */
export type CancellationStage = "before" | "mid-trip" | "ran";

/**
 * Slack after the flag within which an arrival still counts as before it. Ingest
 * polls every minute or two, so the flag can be seen a poll after the vehicle
 * last reported.
 */
export const FLAG_GRACE_SEC = 120;

/**
 * Arrivals after the flag that show a trip kept running. One is the leftover
 * next-stop prediction every flagged trip can have; three rules out a stray
 * second one.
 */
export const RAN_AFTER_MIN_ARRIVALS = 3;

/**
 * Whether an arrival came before the cancellation flag (within the grace).
 * @param detectedAt - ISO instant ingest first saw the cancellation.
 * @param arrivalAt - ISO instant of the arrival.
 * @returns True when the arrival counts as before the flag.
 */
export function arrivedBeforeFlag(detectedAt: string, arrivalAt: string): boolean {
  return Date.parse(arrivalAt) <= Date.parse(detectedAt) + FLAG_GRACE_SEC * 1000;
}

/**
 * Classify a flagged trip by its recorded arrivals against the flag.
 * @param detectedAt - ISO instant ingest first saw the cancellation.
 * @param arrivals - ISO instants of the trip's real (non-ghost) arrivals on that day, any order.
 * @returns The stage the cancellation reached.
 */
export function cancellationStage(
  detectedAt: string,
  arrivals: readonly string[],
): CancellationStage {
  const before = arrivals.filter((at) => arrivedBeforeFlag(detectedAt, at)).length;
  if (arrivals.length - before >= RAN_AFTER_MIN_ARRIVALS) return "ran";
  return before > 0 ? "mid-trip" : "before";
}

/** Badge label for each stage, as used on the trip boards and lists. */
export const CANCELLATION_BADGE: Record<CancellationStage, string> = {
  before: "CANCELLED",
  "mid-trip": "CANCELLED MID-TRIP",
  ran: "REINSTATED",
};

/** Narrower badge labels for a phone-width row, where the full one crowds out the trip's time. */
export const CANCELLATION_BADGE_SHORT: Record<CancellationStage, string> = {
  before: "CANCELLED",
  "mid-trip": "CUT SHORT",
  ran: "REINSTATED",
};

/**
 * What each stage badge means, in words. Read by the key under each board that
 * shows these badges, so the meaning does not live only in a hover a phone
 * cannot reach - which also matters most on a phone, where the row carries the
 * shorter label of the two.
 */
export const CANCELLATION_BADGE_MEANING: Record<CancellationStage, string> = {
  before: "AT cancelled this trip",
  "mid-trip": "AT cancelled this trip after it set off",
  ran: "AT flagged this trip cancelled, then it ran anyway",
};

/** Badge styling per stage: reinstated is an outline, an actual cancellation is solid. */
export const CANCELLATION_BADGE_CLASS: Record<CancellationStage, string> = {
  before: "bg-at-late text-white",
  "mid-trip": "bg-at-late text-white",
  ran: "border border-at-border text-at-muted",
};
