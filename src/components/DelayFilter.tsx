"use client";
// src/components/DelayFilter.tsx
// Filter box narrowing rankings to routes running late, early, or either way.

import { FilterMenu, FilterOption } from "@/components/FilterMenu";
import type { DelayDirection } from "@/lib/rankings";
import { buildHref } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useId, type JSX } from "react";

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
const DIRS: { key: DelayDirection; label: string; activeClass?: string }[] = [
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
  const router = useRouter();
  const name = useId();
  const current = DIRS.find((d) => d.key !== null && d.key === active);
  /**
   * Navigate to the page on a direction.
   * @param key - The direction, or null for either way.
   */
  const choose = (key: DelayDirection): void => {
    router.push(buildHref(basePath, { ...preservedParams, dir: key ?? undefined }), {
      scroll: false,
    });
  };
  return (
    <FilterMenu
      label="Running"
      summary={current?.label ?? null}
      onReset={() => choose(null)}
      activeClass={current?.activeClass}
    >
      {DIRS.map((d) => (
        <FilterOption
          key={d.label}
          type="radio"
          name={name}
          checked={active === d.key}
          onChange={() => choose(d.key)}
        >
          {d.label}
        </FilterOption>
      ))}
    </FilterMenu>
  );
}
