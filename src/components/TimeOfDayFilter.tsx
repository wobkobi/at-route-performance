// src/components/TimeOfDayFilter.tsx
// Chip row narrowing a route's figures to a part of the service day.
import { cn } from "@/lib/cn";
import { type HourRange, TIME_PRESETS } from "@/lib/time-of-day";
import Link from "next/link";
import type { JSX } from "react";

/** Props for {@link TimeOfDayFilter}. */
export interface TimeOfDayFilterProps {
  /** The active range, or null for the whole day. */
  active: HourRange | null;
  /** Pre-built href per preset key, plus a required "all" for the null case. */
  hrefs: Record<string, string> & { all: string };
}

/**
 * Time-of-day chips for the route page. Like the direction chips, these use
 * `scroll={false}` so choosing a part of the day does not throw the reader back
 * to the top of a page they were already partway down.
 * @param props - Component props.
 * @param props.active - The active range, or null for all day.
 * @param props.hrefs - Pre-built hrefs keyed by preset key, plus "all".
 * @returns The chips row element.
 */
export function TimeOfDayFilter({ active, hrefs }: TimeOfDayFilterProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs tracking-zero text-at-muted uppercase">Time</span>
      <Link
        href={hrefs.all}
        scroll={false}
        aria-current={active == null ? "true" : undefined}
        className={cn("chip", active == null ? "chip-on" : "chip-off")}
      >
        All day
      </Link>
      {TIME_PRESETS.map((preset) => {
        const isActive = active?.from === preset.range.from && active.to === preset.range.to;
        return (
          <Link
            key={preset.key}
            href={hrefs[preset.key] ?? hrefs.all}
            scroll={false}
            aria-current={isActive ? "true" : undefined}
            className={cn("chip", isActive ? "chip-on" : "chip-off")}
          >
            {preset.label}
          </Link>
        );
      })}
    </div>
  );
}
