// src/components/shame/FlameCount.tsx
// The repeat-offender flame on shame rows: one colour per kind of count, and the
// count carries its unit, so "3h" and "4d" never read as the same thing.

import { cn } from "@/lib/cn";
import type { JSX } from "react";
import { FaFire } from "react-icons/fa";

/**
 * What a flame counts: the route's hours on today's board, the days in a row it
 * has been on a board, or the days a board crowned it (in a row on a day board,
 * within the period on a week or month board).
 */
export type FlameKind = "hours" | "days" | "crown";

/** Each kind's colour class and the unit its count is written with. */
const FLAME: Record<FlameKind, { className: string; unit: string }> = {
  hours: { className: "text-flame-hours", unit: "h" },
  days: { className: "text-flame-days", unit: "d" },
  crown: { className: "text-flame-crown", unit: "d" },
};

/**
 * Inline flame icon + count badge for shame rows. When `worst` is true the
 * badge is bolder and slightly larger, to mark the day's worst row.
 * @param props - Component props.
 * @param props.kind - What the count is: hours today, days on the board, or crowned days.
 * @param props.count - The hours or days (2 or more).
 * @param props.worst - True when this row holds the day's worst badge.
 * @param props.label - Tooltip text shown on hover and keyboard focus.
 * @returns The badge element.
 */
export function FlameCount({
  kind,
  count,
  worst,
  label,
}: {
  kind: FlameKind;
  count: number;
  worst?: boolean;
  label?: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        "group/flame relative flex items-center gap-0.5 leading-none",
        FLAME[kind].className,
      )}
      tabIndex={label ? 0 : undefined}
      aria-label={label}
    >
      <FaFire aria-hidden className={cn("shrink-0", worst ? "h-4 w-4" : "h-3.5 w-3.5")} />
      <span className={cn("text-sm tabular-nums", worst ? "font-bold" : "font-semibold")}>
        {count}
        {FLAME[kind].unit}
      </span>
      {label && (
        /*
          Hidden with `display: none`, not with `opacity-0`: an opacity-0 box is
          still laid out and still counts towards the page's scrollable width, so
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
