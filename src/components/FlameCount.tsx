// src/components/FlameCount.tsx
// Render flame icons whose colour scales with a tier-and-count severity.

import { cn } from "@/lib/cn";
import type { JSX } from "react";
import { FaFire } from "react-icons/fa";

export type FlameTier = "day" | "week" | "streak";

/**
 * Normalised severity 0-1 across all three tiers and counts.
 *   day    fills 0.00-0.40  (practical max ~8 hourly slots)
 *   week   fills 0.40-0.70  (hard max 7 days)
 *   streak fills 0.70-1.00  (unbounded; count-2 so streak-2 = tier floor)
 * Within each tier the count scales the severity toward that tier's ceiling.
 * @param tier - Severity tier.
 * @param count - Repeat count or streak length.
 * @returns Normalised 0-1 severity value.
 */
function flameSeverity(tier: FlameTier, count: number): number {
  switch (tier) {
    case "day":
      return (Math.min(count, 8) / 8) * 0.4;
    case "week":
      return 0.4 + (Math.min(count, 7) / 7) * 0.3;
    case "streak":
      return 0.7 + (Math.min(count - 2, 8) / 8) * 0.3;
  }
}

/**
 * Five visually distinct colours from one normalised severity score.
 * Blue is deliberately excluded, hot though a blue flame is: blue is the
 * on-time colour everywhere else on the site, so the badge for the worst
 * routes on it was painted the same shade as its all-clear. Cosmic is the
 * palette's own step past crimson and stays clearly apart from it.
 *
 *   amber   s < 0.15  day, count 2
 *   orange  s < 0.35  day, count 3-6
 *   red     s < 0.60  day 7-8 / week 2-4
 *   crimson s < 0.85  week 5-7 / streak 2-5
 *   cosmic  s >= 0.85 streak 6+ (chronic)
 * @param tier - Severity tier.
 * @param count - Repeat count or streak length.
 * @returns Hex colour string.
 */
function flameColour(tier: FlameTier, count: number): string {
  const s = flameSeverity(tier, count);
  if (s >= 0.85) return "#773581"; // at-cosmic
  if (s >= 0.6) return "#B91C1C"; // red-700  (crimson)
  if (s >= 0.35) return "#EF4444"; // red-500
  if (s >= 0.15) return "#F97316"; // orange-500
  return "#FBBF24"; // amber-400
}

/**
 * Inline flame icon + count badge for shame rows.
 *
 * Colour is derived from a normalised severity score so that each tier's
 * lowest count always looks hotter than the tier below's highest count.
 * When `worst` is true the badge is bolder and slightly larger to signal that
 * this route was the overall worst of the day.
 * @param props - Component props.
 * @param props.tier - Severity tier: same-day repeats, week appearances, or streak.
 * @param props.count - Repeat count or streak length (must be >= 2).
 * @param props.worst - True when this row holds the day's worst badge.
 * @param props.label - Tooltip text shown on hover and keyboard focus.
 * @returns The badge element.
 */
export function FlameCount({
  tier,
  count,
  worst,
  label,
}: {
  tier: FlameTier;
  count: number;
  worst?: boolean;
  label?: string;
}): JSX.Element {
  const colour = flameColour(tier, count);
  return (
    <span
      className="group/flame relative flex items-center gap-0.5 leading-none"
      tabIndex={label ? 0 : undefined}
      aria-label={label}
    >
      <FaFire
        aria-hidden
        className={cn("shrink-0", worst ? "h-4 w-4" : "h-3.5 w-3.5")}
        style={{ color: colour }}
      />
      <span
        className={cn("text-sm tabular-nums", worst ? "font-bold" : "font-semibold")}
        style={{ color: colour }}
      >
        {count}
      </span>
      {label && (
        /*
          Hidden with `display: none`, not with `opacity-0`: an opacity-0 box is
          still laid out and still counts toward the page's scrollable width, so
          a label wider than the badge's room gave the whole board a horizontal
          scrollbar while the tooltip was invisible. Bounded and wrapping for the
          same reason - these labels grow with the route name, the day count and
          the period's own words ("in the last 7 days"). `w-max` before the bound:
          an absolutely positioned box otherwise shrink-wraps to its containing
          block, which here is a 30px badge, and the label wrapped one word per
          line.
        */
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-max max-w-56 -translate-x-1/2 rounded bg-at-ink px-2 py-1 text-center text-xs font-medium text-white shadow-md group-hover/flame:block group-focus-visible/flame:block"
        >
          {label}
        </span>
      )}
    </span>
  );
}
