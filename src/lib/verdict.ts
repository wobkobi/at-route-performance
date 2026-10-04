// src/lib/verdict.ts
// The one-word verdict on a window's network on-time share, and the scale it
// is read from. Pure and client-safe.

import type { DelayDirection } from "@/lib/rankings";

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
 * 58% and 68%, so a conventional scale (90% good, under 50% bad) would print
 * the same word every day. These floors put a typical weekday mid-scale, so the
 * word can move both ways: 55-66 is the ordinary weekday, 66-72 the best days
 * so far, and the top two rungs are what a train-only view or a quiet holiday
 * reaches. Bit bad reaches down to 55 because Mondays run a few points under the
 * rest of the week (60.6% and 60.8% in September 2026), and a school-holiday
 * Monday a couple under that, so a floor at 60 turned an ordinary Monday's dip
 * into the bottom word. The bottom rung's floor of 0 makes the list total over 0-100.
 */
export const VERDICT_BANDS: readonly VerdictBand[] = [
  { floor: 80, label: "Great", toneClass: "text-at-ontime", barClass: "bg-at-ontime" },
  { floor: 72, label: "Fine", toneClass: "text-at-ontime", barClass: "bg-at-ontime" },
  { floor: 66, label: "Meh", toneClass: "text-at-ink", barClass: "bg-at-ink" },
  { floor: 55, label: "Bit bad", toneClass: "text-at-late", barClass: "bg-at-late" },
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

/** Which way a window's off-schedule arrivals mostly went. */
export type VerdictLean = NonNullable<DelayDirection> | "both";

/**
 * How many times the other side's share one side has to reach before the
 * window is said to have run that way. A typical weekday runs about 29% early
 * against 8% late, so it reads early; a day at 12% late and 9% early reads as both.
 */
const LEAN_RATIO = 2;

/**
 * Which way the off-schedule arrivals went, so a low verdict says whether riders
 * were left waiting or watched their bus leave without them.
 * @param earlyPct - Share of arrivals early, or null when unknown.
 * @param latePct - Share of arrivals late, or null when unknown.
 * @returns The lean, or null when either share is unknown or nothing was off schedule.
 */
export function verdictLean(earlyPct: number | null, latePct: number | null): VerdictLean | null {
  if (earlyPct === null || latePct === null || earlyPct + latePct <= 0) return null;
  if (earlyPct >= latePct * LEAN_RATIO) return "early";
  if (latePct >= earlyPct * LEAN_RATIO) return "late";
  return "both";
}

/** The line under the verdict word for each {@link VerdictLean}. */
export const LEAN_PHRASE: Record<VerdictLean, string> = {
  early: "Mostly running early",
  late: "Mostly running late",
  both: "Off both ways",
};

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
