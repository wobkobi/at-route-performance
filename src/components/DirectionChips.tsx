"use client";

import { cn } from "@/lib/cn";
import Link from "next/link";
import type { JSX } from "react";

/** Props for {@link DirectionChips}. */
export interface DirectionChipsProps {
  /** Sorted direction ids to show as chips. */
  dirKeys: number[];
  /** Currently active direction (null = both). */
  activeDir: number | null;
  /** Display label per direction id. */
  labels: Record<number, string>;
  /** Pre-built href for each direction id, plus "both" for the null case. */
  hrefs: Record<string, string>;
}

/**
 * Direction filter chips for the route page. Uses Next.js Link with
 * `scroll={false}` so clicking a chip doesn't reset the page scroll position.
 * @param props - Component props.
 * @param props.dirKeys - Sorted direction ids.
 * @param props.activeDir - Active direction (null = both).
 * @param props.labels - Display label per direction id.
 * @param props.hrefs - Pre-built hrefs keyed by direction id string and "both".
 * @returns The chips row element.
 */
export function DirectionChips({
  dirKeys,
  activeDir,
  labels,
  hrefs,
}: DirectionChipsProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs tracking-zero text-at-muted uppercase">Direction</span>
      <Link
        href={hrefs.both}
        scroll={false}
        className={cn("chip", activeDir == null ? "chip-on" : "chip-off")}
      >
        Both
      </Link>
      {dirKeys.map((d) => (
        <Link
          key={d}
          href={hrefs[String(d)] ?? hrefs.both}
          scroll={false}
          className={cn("chip", activeDir === d ? "chip-on" : "chip-off")}
        >
          {labels[d]}
        </Link>
      ))}
    </div>
  );
}
