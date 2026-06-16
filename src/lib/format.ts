// src/lib/format.ts

/** Options for {@link formatDelay}. */
export interface FormatDelayOptions {
  /** Deviations with magnitude <= this many seconds render as "on time". */
  thresholdSec?: number;
}

/**
 * Render a signed schedule deviation as a human string with no decimals.
 * Negative is early, positive is late; zero components are dropped.
 * @param sec - Signed deviation in seconds (negative early, positive late).
 * @param options - Optional threshold below which the value reads "on time".
 * @returns A string like `6m 18s late`, `3m early`, `45s late`, or `on time`.
 */
export function formatDelay(sec: number, options: FormatDelayOptions = {}): string {
  const threshold = options.thresholdSec ?? 0;
  const rounded = Math.round(sec);
  if (Math.abs(rounded) <= threshold) return "on time";

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
