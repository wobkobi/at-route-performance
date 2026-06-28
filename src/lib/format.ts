// src/lib/format.ts

import { isOnTime } from "@/lib/on-time";

/** Options for {@link formatDelay}. */
export interface FormatDelayOptions {
  /** Deviations with magnitude <= this many seconds render as "on time". */
  thresholdSec?: number;
  /**
   * Route mode: when given, "on time" uses the mode's asymmetric on-time window
   * (overrides {@link FormatDelayOptions.thresholdSec}).
   */
  mode?: string;
}

/**
 * Render a signed schedule deviation as a human string with no decimals.
 * Negative is early, positive is late; zero components are dropped.
 * @param sec - Signed deviation in seconds (negative early, positive late).
 * @param options - On-time rule: a `mode` (asymmetric on-time window) or a
 *   symmetric `thresholdSec`; below it the value reads "on time".
 * @returns A string like `6m 18s late`, `3m early`, `45s late`, or `on time`.
 */
export function formatDelay(sec: number, options: FormatDelayOptions = {}): string {
  const rounded = Math.round(sec);
  const onTime =
    options.mode !== undefined
      ? isOnTime(rounded, options.mode)
      : Math.abs(rounded) <= (options.thresholdSec ?? 0);
  if (onTime) return "on time";

  const direction = rounded > 0 ? "late" : "early";
  const total = Math.abs(rounded);
  const mins = Math.floor(total / 60);
  const secs = total % 60;

  const parts: string[] = [];
  if (mins > 0) parts.push(`${mins}m`);
  if (secs > 0) parts.push(`${secs}s`);
  // parts is non-empty here: total > threshold >= 0 implies total >= 1.
  return `${parts.join(" ")} ${direction}`;
}

/**
 * Render a non-negative duration in seconds as `6m 18s` / `3m` / `45s` / `0s`
 * (no direction word). For magnitudes like "off-schedule by".
 * @param sec - A duration in seconds (rounded; negatives are treated as 0).
 * @returns The compact duration string.
 */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  const parts: string[] = [];
  if (mins > 0) parts.push(`${mins}m`);
  if (secs > 0 || mins === 0) parts.push(`${secs}s`);
  return parts.join(" ");
}

/**
 * Auckland-local day/month and year parts of a UTC instant.
 * @param d - UTC instant.
 * @returns `{ dm: "DD/MM", y: "YYYY" }`.
 */
export function dmY(d: Date): { dm: string; y: string } {
  const o: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d)) {
    o[part.type] = part.value;
  }
  return { dm: `${o.day}/${o.month}`, y: o.year };
}

/**
 * Format a GTFS departure time string ("HH:MM:SS") as a short 12-hour clock
 * string. Handles GTFS extended times where hours >= 24 represent post-midnight
 * trips on the following calendar day (e.g. "25:30:00" displays as "1:30am").
 * @param hms - GTFS time string or null.
 * @returns Formatted time like "9:05am" / "1:30am", or null when input is null.
 */
export function formatGtfsTime(hms: string | null): string | null {
  if (!hms) return null;
  const parts = hms.split(":");
  if (parts.length < 2) return null;
  let hours = parseInt(parts[0], 10);
  const mins = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(mins)) return null;
  // GTFS extended time: hours >= 24 wrap to the next calendar day.
  const suffix = hours % 24 < 12 ? "am" : "pm";
  hours = (hours % 24) % 12 || 12;
  return `${hours}:${String(mins).padStart(2, "0")}${suffix}`;
}
