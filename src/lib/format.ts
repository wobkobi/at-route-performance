// src/lib/format.ts
// Formatting helpers for delays, dates and other display values.

// From the leaf rather than time.ts, which imports this module.
import { NZ_TZ } from "@/lib/nz-tz";
import { isConsistentlyLateOrEarly, isOnTime } from "@/lib/on-time";

/** What an unknown or unrenderable number reads as, matching the tables' placeholder. */
export const UNKNOWN_VALUE = "\u2014";

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
 * @returns A string like `6m 18s late`, `3m early`, `45s late`, or `on time`;
 *   the unknown dash for a value that is not a finite number.
 */
export function formatDelay(sec: number, options: FormatDelayOptions = {}): string {
  if (!Number.isFinite(sec)) return UNKNOWN_VALUE;
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
 * @returns The compact duration string, or the unknown dash for a value that is
 *   not a finite number.
 */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return UNKNOWN_VALUE;
  const total = Math.max(0, Math.round(sec));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  const parts: string[] = [];
  if (mins > 0) parts.push(`${mins}m`);
  if (secs > 0 || mins === 0) parts.push(`${secs}s`);
  return parts.join(" ");
}

/**
 * Seconds as hours and minutes ("16h 6m"), the way a shift is read.
 * @param sec - Seconds.
 * @returns The label.
 */
export function formatHours(sec: number): string {
  const mins = Math.round(sec / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** How an {@link offScheduleValue} reads at a glance: its colour band, or mixed. */
export type OffScheduleTone = "ontime" | "early" | "late" | "mixed" | "unknown";

/** Text colour for each {@link OffScheduleTone}; a mixed row stays neutral ink. */
export const OFF_SCHEDULE_TONE_CLASS: Record<OffScheduleTone, string> = {
  ontime: "text-at-ontime",
  early: "text-at-early-strong",
  late: "text-at-late",
  mixed: "text-at-ink",
  unknown: "text-at-muted",
};

/**
 * The value a board ranked by average absolute deviation prints for one row.
 * Always a distance: a run 2m late inside the on-time window reads "2m late" in
 * the on-time colour, never the bare words "on time", or a board sorted "Most
 * off" would list rows whose value names no distance at all. A consistently
 * late or early row carries its direction; a mixed one, whose signed average
 * is partly cancelled out, shows the magnitude as "5m 10s off".
 * @param signedSec - Signed average deviation in seconds, or null when unknown.
 * @param absSec - Average absolute deviation in seconds, or null to fall back
 *   to the signed value's magnitude.
 * @param mode - Route mode, for the on-time window behind the colour.
 * @returns The text and its tone; the unknown dash when neither figure exists.
 */
export function offScheduleValue(
  signedSec: number | null,
  absSec: number | null,
  mode: string,
): { text: string; tone: OffScheduleTone } {
  if (signedSec == null && absSec == null) return { text: UNKNOWN_VALUE, tone: "unknown" };
  const signed = signedSec ?? 0;
  const abs = absSec ?? Math.abs(signed);
  if (!isConsistentlyLateOrEarly(signed, abs)) {
    return { text: `${formatDuration(abs)} off`, tone: "mixed" };
  }
  const tone = isOnTime(signed, mode) ? "ontime" : signed < 0 ? "early" : "late";
  // A zero threshold names the distance even inside the window; only a run
  // that rounds to exactly 0s still reads "on time".
  return { text: formatDelay(signed, { thresholdSec: 0 }), tone };
}

/**
 * Auckland-local day/month and year parts of a UTC instant.
 * @param d - UTC instant.
 * @returns `{ dm: "DD/MM", y: "YYYY" }`.
 */
export function dmY(d: Date): { dm: string; y: string } {
  const o: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d)) {
    o[part.type] = part.value;
  }
  const { day, month, year } = o;
  // Every requested part is always emitted; fail loudly rather than render "undefined".
  if (day === undefined || month === undefined || year === undefined) {
    throw new Error("Intl.DateTimeFormat omitted a requested day/month/year part");
  }
  return { dm: `${day}/${month}`, y: year };
}

/**
 * Format a GTFS departure time string ("HH:MM:SS") as a short 12-hour clock
 * string. Handles GTFS extended times where hours >= 24 represent post-midnight
 * trips on the following calendar day (e.g. "25:30:00" displays as "1:30 am").
 * Spaced like the en-NZ clock times elsewhere on the site.
 * @param hms - GTFS time string or null.
 * @returns Formatted time like "9:05 am" / "1:30 am", or null when input is null.
 */
export function formatGtfsTime(hms: string | null): string | null {
  if (!hms) return null;
  const [h, m] = hms.split(":");
  if (h === undefined || m === undefined) return null;
  let hours = parseInt(h, 10);
  const mins = parseInt(m, 10);
  if (isNaN(hours) || isNaN(mins)) return null;
  // GTFS extended time: hours >= 24 wrap to the next calendar day.
  const suffix = hours % 24 < 12 ? "am" : "pm";
  hours = (hours % 24) % 12 || 12;
  return `${hours}:${String(mins).padStart(2, "0")} ${suffix}`;
}
