// src/lib/format.ts
// Formatting helpers for delays, dates and other display values.

// From the leaf rather than time/service-day.ts, which imports this module.
import { delayBand, type DelayBand, isConsistentlyLateOrEarly, isOnTime } from "@/lib/on-time";

/** What an unknown or unrenderable number reads as, matching the tables' placeholder. */
export const UNKNOWN_VALUE = "\u2014";

/** Built once: an `Intl` formatter costs far more to make than to call. */
const COUNT_FORMAT = new Intl.NumberFormat("en-NZ", { maximumFractionDigits: 0 });

/**
 * A count as the site prints it, grouped the NZ way ("12,345").
 * @param n - The count.
 * @returns The grouped figure.
 */
export function formatCount(n: number): string {
  return COUNT_FORMAT.format(n);
}

/**
 * The noun alone for a count, singular only for exactly one, for a line whose
 * count is printed somewhere else (a card's hero figure).
 * @param n - The count.
 * @param one - The singular noun.
 * @param many - The plural, when it is not the singular plus "s".
 * @returns The noun.
 */
export function pluralNoun(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/**
 * A count with its noun, singular only for exactly one ("1 trip", "12,345 arrivals").
 * @param n - The count.
 * @param one - The singular noun.
 * @param many - The plural, when it is not the singular plus "s".
 * @returns The count and noun.
 */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${pluralNoun(n, one, many)}`;
}

/**
 * A percentage to one decimal place ("85.0%"), the one precision every share on
 * the site is shown at so two figures side by side always compare.
 * @param pct - The percentage (0-100), or null when it cannot be told.
 * @returns The text, or {@link UNKNOWN_VALUE}.
 */
export function formatPct(pct: number | null | undefined): string {
  return pct == null || !Number.isFinite(pct) ? UNKNOWN_VALUE : `${pct.toFixed(1)}%`;
}

/** "1 in N" denominators for a small share, so "1 in 70" never reads as "1 in 67". */
const FEW_IN = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100];
/** Denominators for a large share, kept to ones people say ("9 in 10", "19 in 20"). */
const MOST_IN = [2, 3, 4, 5, 10, 20, 30, 50, 100];
/** The fractions past "1 in N" worth saying, for a share between a fifth and a half. */
const NON_UNIT: [number, number][] = [
  [2, 5],
  [3, 10],
];

/**
 * A share as an everyday fraction ("about 2 in 5", "about 3 in 4"), so a note
 * says how often a rider meets it rather than restating the percentage.
 *
 * Works on the smaller side of the split (the share, or what is left of it past
 * half), picks the fraction nearest by relative error, and turns it back round
 * for a share over half: 75% is 1 in 4 left over, so "3 in 4". Relative error
 * keeps a small share honest (3% is "1 in 30", not "1 in 20"); a tie goes to the
 * smaller denominator, so 45% reads "1 in 2" rather than "2 in 5". A large share
 * takes only the denominators people say, so 92% is "9 in 10", not "11 in 12".
 * @param pct - The share, 0-100.
 * @returns The phrase; "nearly all" over 99%, null under 1%, where "1 in 150"
 *   reads as more precise than the share it came from.
 */
export function shareFraction(pct: number): string | null {
  if (!Number.isFinite(pct) || pct < 1) return null;
  if (pct > 99) return "nearly all";
  const most = pct > 50;
  const minority = (most ? 100 - pct : pct) / 100;
  const units = (most ? MOST_IN : FEW_IN).map((d): [number, number] => [1, d]);
  const options = [...units, ...NON_UNIT].sort((a, b) => a[1] - b[1]);
  let best: [number, number] = [1, 2];
  let bestErr = Infinity;
  for (const [n, d] of options) {
    const err = Math.abs(n / d - minority) / minority;
    if (err < bestErr - 1e-9) [best, bestErr] = [[n, d], err];
  }
  const [n, d] = best;
  return `about ${most ? d - n : n} in ${d}`;
}

/**
 * A percentage clamped to a bar's track, for a CSS width or height.
 * @param pct - The percentage, or null (drawn empty).
 * @param floor - The least it draws at, so a sliver stays visible.
 * @returns A number from `floor` to 100.
 */
export function barPct(pct: number | null | undefined, floor = 0): number {
  return Math.min(100, Math.max(floor, pct ?? 0));
}

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
 *
 * The site-wide rule: a single trip's verdict at one stop (the trip line, a
 * live vehicle) passes `mode`, so inside the mode's on-time window it reads "on
 * time". An average passes `thresholdSec: 0` and always names its distance
 * ("2m late"), coloured by the band it falls in, since "on time" over a mean of
 * late and early arrivals would hide how far off they were.
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

/**
 * How an {@link offScheduleValue} reads at a glance: the {@link DelayBand} a map
 * pin would give it, plus the two states a single deviation cannot be in - a
 * mixed average, and no figure at all.
 */
export type OffScheduleTone = DelayBand | "mixed" | "none";

/** Text colour for each {@link OffScheduleTone}; a mixed row stays neutral ink. */
export const OFF_SCHEDULE_TONE_CLASS: Record<OffScheduleTone, string> = {
  ontime: "text-at-ontime",
  early: "text-at-early-strong",
  late: "text-at-late",
  mixed: "text-at-ink",
  none: "text-at-muted",
};

/**
 * Fill colour for a bar drawn beside an {@link offScheduleValue}. These are the
 * swatch colours a board's own colour key prints, not the text colours above:
 * `early` reads as the bright green in a swatch and needs the darker
 * `early-strong` only as type, so a bar taking its colour from the text map
 * would not match the key that explains it.
 */
export const OFF_SCHEDULE_BAR_CLASS: Record<OffScheduleTone, string> = {
  ontime: "bg-at-ontime",
  early: "bg-at-early",
  late: "bg-at-late",
  mixed: "bg-at-ink",
  none: "bg-at-border",
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
  if (signedSec == null && absSec == null) return { text: UNKNOWN_VALUE, tone: "none" };
  const signed = signedSec ?? 0;
  const abs = absSec ?? Math.abs(signed);
  if (!isConsistentlyLateOrEarly(signed, abs)) {
    return { text: `${formatDuration(abs)} off`, tone: "mixed" };
  }
  // Banded, not compared raw: `delayBand` rounds first, as the text does, so two
  // rows both reading "5m late" (299.6s and 300.4s) get one colour - and the
  // same colour the map pin and the vehicle page give that run.
  const tone = delayBand(signed, mode);
  // A zero threshold names the distance even inside the window; only a run
  // that rounds to exactly 0s still reads "on time".
  return { text: formatDelay(signed, { thresholdSec: 0 }), tone };
}

/**
 * A column heading as it reads mid-sentence: "To the start" > "to the start", "Clockwise" >
 * "clockwise". Only the first letter changes, so a stop's name keeps its capitals.
 * @param heading - The heading.
 * @returns It with a lower-case first letter.
 */
export function midSentence(heading: string): string {
  return heading.charAt(0).toLowerCase() + heading.slice(1);
}

/**
 * A phrase as it reads at the start of a line: "to Britomart" > "To Britomart".
 * Only the first letter changes, the reverse of {@link midSentence}.
 * @param phrase - The phrase.
 * @returns It with an upper-case first letter.
 */
export function sentenceStart(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * Fold text for search: lower case, macrons and other accents off, spaces and
 * hyphens gone, so "city link" finds "CityLink", "tamaki" finds "TāmakiLink" and
 * "sc" finds "S-C".
 * @param s - The text.
 * @returns The folded text.
 */
export function searchFold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "");
}
