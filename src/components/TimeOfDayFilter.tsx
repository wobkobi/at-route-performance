// src/components/TimeOfDayFilter.tsx
// Chip row narrowing a route's figures to a part of the service day.
import { cn } from "@/lib/cn";
import { activePreset, hourRangeLabel, TIME_PRESETS, type HourRange } from "@/lib/time-of-day";
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
 * to the top of a page they were already partway down. A range outside the
 * presets is named in a chip of its own rather than offered as a choice, so the
 * row always says what the figures beside it cover.
 * @param props - Component props.
 * @param props.active - The active range, or null for all day.
 * @param props.hrefs - Pre-built hrefs keyed by preset key, plus "all".
 * @returns The chips row element.
 */
export function TimeOfDayFilter({ active, hrefs }: TimeOfDayFilterProps): JSX.Element {
  const preset = activePreset(active);
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
      {TIME_PRESETS.map((p) => {
        const isActive = p === preset;
        return (
          <Link
            key={p.key}
            href={hrefs[p.key] ?? hrefs.all}
            scroll={false}
            aria-current={isActive ? "true" : undefined}
            className={cn("chip", isActive ? "chip-on" : "chip-off")}
          >
            {p.label}
          </Link>
        );
      })}
      {/* A range no preset covers - a shame board links the single hour its
          figures came from - would otherwise narrow the whole page with every
          chip unlit, leaving a part-of-day figure to be read as the day's. Named
          rather than offered, since it is the state the page is already in. */}
      {active && !preset && (
        <span className="chip chip-on" aria-current="true">
          {hourRangeLabel(active)}
        </span>
      )}
    </div>
  );
}
