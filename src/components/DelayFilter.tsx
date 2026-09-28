// src/components/DelayFilter.tsx
// Chip row filtering rankings by late, early, or all delay directions.

import { ChipLink } from "@/components/Chip";
import type { DelayDirection } from "@/lib/rankings";
import { buildHref } from "@/lib/utils";
import type { JSX } from "react";

/** Props for {@link DelayFilter}. */
export interface DelayFilterProps {
  /** Currently active direction, or null for either way. */
  active: DelayDirection;
  /** Page path the chips link to. */
  basePath: string;
  /** Query params to preserve on the links (the `dir` param is set here). */
  preservedParams: Record<string, string>;
}

// "Either way" rather than "All", the word `RouteExplorer`'s own direction chips
// use: a board that also carries a mode row would otherwise stack two filled
// "All" chips that read as one duplicated control.
const DIRS: { key: "" | "late" | "early"; label: string; activeClass: string }[] = [
  { key: "", label: "Either way", activeClass: "bg-at-shore text-white" },
  { key: "late", label: "Late", activeClass: "bg-at-late text-white" },
  { key: "early", label: "Early", activeClass: "bg-at-early text-at-ink" },
];

/**
 * Render Either way/Late/Early chips that filter a board by the direction its
 * rows run off schedule.
 * @param props - Component props.
 * @param props.active - The active direction, or null for either way.
 * @param props.basePath - Page path the chips link to.
 * @param props.preservedParams - Query params to keep when switching direction.
 * @returns The filter chips element.
 */
export function DelayFilter({ active, basePath, preservedParams }: DelayFilterProps): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {DIRS.map((d) => {
        const href = buildHref(basePath, { ...preservedParams, dir: d.key || undefined });
        const isActive = (active ?? "") === d.key;
        return (
          <ChipLink key={d.key || "all"} href={href} active={isActive} activeClass={d.activeClass}>
            {d.label}
          </ChipLink>
        );
      })}
    </div>
  );
}
