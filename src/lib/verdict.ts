// src/lib/verdict.ts
// The one-word verdict on a window's network on-time share, and the scale it
// is read from. Pure and client-safe.

/** One rung of the verdict scale. */
export interface VerdictBand {
  /** Lowest on-time percentage that earns this band. */
  floor: number;
  /** The word the page leads with. */
  label: string;
  /** Text colour for the word. */
  toneClass: string;
  /** Fill colour for the meter segments up to this rung. */
  barClass: string;
}

/**
 * The scale, highest floor first. Every full day on record sits between about
 * 61% and 67%, so a conventional scale (90% good, under 50% bad) would print
 * the same word every day. These floors put a typical weekday mid-scale, so the
 * word can move both ways: 60-66 is the ordinary weekday, 66-72 the best days
 * so far, and the top two rungs are what a train-only view or a quiet holiday
 * reaches. The bottom rung's floor of 0 makes the list total over 0-100.
 */
export const VERDICT_BANDS: readonly VerdictBand[] = [
  { floor: 80, label: "Great", toneClass: "text-at-ontime", barClass: "bg-at-ontime" },
  { floor: 72, label: "Fine", toneClass: "text-at-ontime", barClass: "bg-at-ontime" },
  { floor: 66, label: "Meh", toneClass: "text-at-ink", barClass: "bg-at-ink" },
  { floor: 60, label: "Bit bad", toneClass: "text-at-late", barClass: "bg-at-late" },
  { floor: 0, label: "Shit", toneClass: "text-at-late", barClass: "bg-at-late" },
];

/**
 * The band an on-time share lands in.
 * @param onTimePct - Network on-time percentage, or null when there is not enough data.
 * @returns The first band whose floor the share meets, or null for a null share.
 */
export function dayVerdict(onTimePct: number | null): VerdictBand | null {
  if (onTimePct === null || !Number.isFinite(onTimePct)) return null;
  return VERDICT_BANDS.find((b) => onTimePct >= b.floor) ?? null;
}

/**
 * A band's rung counted from the worst end, for the meter: 0 for the bottom
 * band up to 4 for the top one.
 * @param band - A band from {@link VERDICT_BANDS}, or null.
 * @returns The 0-based rung, or -1 for null.
 */
export function verdictIndex(band: VerdictBand | null): number {
  if (!band) return -1;
  return VERDICT_BANDS.length - 1 - VERDICT_BANDS.indexOf(band);
}
