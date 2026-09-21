// src/lib/vehicle-status.ts
// What a live vehicle marker says about its delay. The ring colour, the
// floating label and the popup all read this one verdict, so a bus cannot show
// a late ring beside a popup that says it is on time.
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
