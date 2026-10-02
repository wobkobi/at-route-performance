"use client";
// src/components/filter/DelayFilter.tsx
// Filter box narrowing rankings to routes running late, early, or either way.

import { UrlRadioFilter, type RadioOption } from "@/components/filter/RadioFilter";
import type { DelayDirection } from "@/lib/rankings";
import type { JSX } from "react";

/** Props for {@link DelayFilter}. */
export interface DelayFilterProps {
  /** Currently active direction, or null for either way. */
  active: DelayDirection;
  /** Page path the choices navigate to. */
  basePath: string;
  /** Query params to preserve on the way (the `dir` param is set here). */
  preservedParams: Record<string, string>;
}

// "Either way" rather than "All": a board that also carries a Mode box would
// otherwise offer two "All" choices that read as one duplicated control. The
// box takes the chosen direction's colour, late red and early green.
export const DELAY_OPTIONS: readonly RadioOption<DelayDirection>[] = [
  { key: null, label: "Either way" },
  { key: "late", label: "Late", activeClass: "border-at-late bg-at-surface text-at-late" },
  {
    key: "early",
    label: "Early",
    activeClass: "border-at-early-strong bg-at-surface text-at-early-strong",
  },
];

/**
 * A Running filter box whose choices navigate, filtering a board by the
 * direction its rows run off schedule.
 * @param props - Component props.
 * @param props.active - The active direction, or null for either way.
 * @param props.basePath - Page path the choices navigate to.
 * @param props.preservedParams - Query params to keep when switching direction.
 * @returns The filter box.
 */
export function DelayFilter({ active, basePath, preservedParams }: DelayFilterProps): JSX.Element {
  return (
    <UrlRadioFilter
      label="Running"
      param="dir"
      options={DELAY_OPTIONS}
      value={active}
      defaultKey={null}
      basePath={basePath}
      preservedParams={preservedParams}
    />
  );
}
