// src/lib/vehicle-status.ts
// What a live vehicle marker says about its delay and heading. The ring colour,
// the floating label and the popup all read one delay verdict, so a bus cannot
// show a late ring beside a popup that says it is on time.
import { formatDelay } from "@/lib/format";
import { delayBand, type DelayBand } from "@/lib/on-time";

/** A vehicle's delay verdict: its band on the mode's on-time window, or unknown. */
export interface VehicleStatus {
  /** The band the ring is coloured by; unknown when the feed carries no delay. */
  band: DelayBand | "unknown";
  /** The floating label, shown only outside the on-time window. */
  label: string | null;
  /** The popup's delay line. */
  detail: string;
}

/**
 * Classify a live vehicle's delay on its mode's on-time window.
 * @param delaySec - The feed's signed delay (negative early), or null.
 * @param mode - The route's mode, which sets the early tolerance.
 * @returns The band, the label and the popup line.
 */
export function vehicleStatus(delaySec: number | null, mode: string): VehicleStatus {
  if (delaySec == null || !Number.isFinite(delaySec)) {
    return { band: "unknown", label: null, detail: "No live delay" };
  }
  const band = delayBand(delaySec, mode);
  // A zero threshold always names the distance, so "3m late" inside the window
  // still says how late, and the band word says how that counts.
  const distance = formatDelay(delaySec, { thresholdSec: 0 });
  if (band !== "ontime") return { band, label: distance, detail: distance };
  return {
    band,
    label: null,
    detail: distance === "on time" ? "On time" : `${distance}, inside the on-time window`,
  };
}

/**
 * A feed bearing as a heading the map can draw, or null when it names none.
 * AT sends 0 for a stationary vehicle or one with no heading, so 0 reads as
 * unknown: drawing it would show every parked bus heading due north. A genuine
 * heading of exactly 0.0 is rare enough that losing its arrow costs less than the
 * false ones.
 * @param raw - The feed's bearing, a number or a numeric string.
 * @returns Degrees clockwise from north in [0, 360), or null.
 */
export function parseBearing(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return null;
  return ((n % 360) + 360) % 360;
}
