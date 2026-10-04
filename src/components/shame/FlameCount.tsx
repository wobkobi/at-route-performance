// src/components/shame/FlameCount.tsx
// The repeat-offender flame on shame rows: one colour per kind of count, and the
// count carries its unit, so "3h" and "4d" never read as the same thing.

import { Hint } from "@/components/ui/Hint";
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
 * badge is bolder and slightly larger, to mark the day's worst row. With a
 * label it is a {@link Hint}, so the label opens on tap and focus as well as
 * hover, and lifts over the row's stretched link to be reachable.
 * @param props - Component props.
 * @param props.kind - What the count is: hours today, days on the board, or crowned days.
 * @param props.count - The hours or days (2 or more).
 * @param props.worst - True when this row holds the day's worst badge.
 * @param props.label - What the count means, shown as the badge's tooltip.
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
  const badge = (
    <span className={cn("flex items-center gap-0.5 leading-none", FLAME[kind].className)}>
      <FaFire aria-hidden className={cn("shrink-0", worst ? "h-4 w-4" : "h-3.5 w-3.5")} />
      <span className={cn("text-sm tabular-nums", worst ? "font-bold" : "font-semibold")}>
        {count}
        {FLAME[kind].unit}
      </span>
    </span>
  );
  if (!label) return badge;
  return (
    <Hint hint={label} className="relative z-10" triggerClassName="no-underline">
      {badge}
    </Hint>
  );
}
