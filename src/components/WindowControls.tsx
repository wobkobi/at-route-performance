// src/components/WindowControls.tsx
/**
 * @description Period switcher and previous/next stepper for the week or month window.
 */
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { cn } from "@/lib/cn";
import { buildHref } from "@/lib/utils";
import Link from "next/link";
import type { JSX } from "react";

/** Props for {@link WindowControls}. */
export interface WindowControlsProps {
  /** Active window. */
  window: "week" | "month";
  /** Label of the period being shown (e.g. "Last 7 days" or "June 2026"). */
  periodLabel: string;
  /** Previous-period link, or null at the earliest data. */
  prevHref?: string | null;
  /** Next-period link, or null at the present (latest) period. */
  nextHref?: string | null;
}

/**
 * Render the Week/Month toggle, a prev/next period stepper, and the current
 * period label. The week view starts on the rolling last 7 days; stepping back
 * pages through calendar weeks (the page supplies the links).
 * @param props - Component props.
 * @param props.window - Active window.
 * @param props.periodLabel - Human label for the active period.
 * @param props.prevHref - Previous-period link (omit/null to hide at the edge).
 * @param props.nextHref - Next-period link (omit/null to hide at the present).
 * @returns The controls element.
 */
export function WindowControls({
  window,
  periodLabel,
  prevHref,
  nextHref,
}: WindowControlsProps): JSX.Element {
  const tabs: { key: "week" | "month"; label: string }[] = [
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-2">
        {tabs.map((t) => (
          <a
            key={t.key}
            href={buildHref("/rankings", { window: t.key })}
            className={cn("chip", window === t.key ? "chip-on" : "chip-off")}
          >
            {t.label}
          </a>
        ))}
      </div>
      <div className="flex items-center gap-1">
        {/* Step links are omitted (not disabled) at the edges of the data range. */}
        {prevHref && (
          <Link href={prevHref} className="chip chip-off" aria-label="Previous period">
            <ChevronLeft />
          </Link>
        )}
        <span className="px-1 text-sm font-semibold tabular-nums">{periodLabel}</span>
        {nextHref && (
          <Link href={nextHref} className="chip chip-off" aria-label="Next period">
            <ChevronRight />
          </Link>
        )}
      </div>
    </div>
  );
}
