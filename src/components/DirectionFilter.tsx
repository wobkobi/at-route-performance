// src/components/DirectionFilter.tsx
// Chip row linking between a route's directions, with a "both" option for the unfiltered view.
import { ChipLink } from "@/components/Chip";
import type { JSX } from "react";

/** Props for {@link DirectionFilter}. */
export interface DirectionFilterProps {
  /** Sorted direction ids to show as chips. */
  dirKeys: number[];
  /** Currently active direction (null = both). */
  activeDir: number | null;
  /** Display label per direction id. */
  labels: Record<number, string>;
  /** Pre-built href for each direction id, plus a required "both" for the null case. */
  hrefs: Record<string, string> & { both: string };
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
export function DirectionFilter({
  dirKeys,
  activeDir,
  labels,
  hrefs,
}: DirectionFilterProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs tracking-zero text-at-muted uppercase">Direction</span>
      <ChipLink href={hrefs.both} active={activeDir == null}>
        Both
      </ChipLink>
      {dirKeys.map((d) => (
        <ChipLink key={d} href={hrefs[String(d)] ?? hrefs.both} active={activeDir === d}>
          {labels[d]}
        </ChipLink>
      ))}
    </div>
  );
}
