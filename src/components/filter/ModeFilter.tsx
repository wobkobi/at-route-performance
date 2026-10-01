"use client";
// src/components/filter/ModeFilter.tsx
// Filter box narrowing a page by transport mode - bus, train, ferry, or all.

import { UrlRadioFilter, type RadioOption } from "@/components/filter/RadioFilter";
import { MODE_NAME, MODES, type Mode } from "@/lib/mode";
import type { JSX } from "react";

/** Props for {@link ModeFilter}. */
export interface ModeFilterProps {
  /** Currently active mode, or null for "All". */
  active: Mode | null;
  /** Page path the choices navigate to. */
  basePath: string;
  /** Query params to preserve on the way (the `mode` param is set here). */
  preservedParams: Record<string, string>;
  /**
   * Set of mode keys that have qualifying data for the current period. When
   * provided, modes not in the set are left out of the list rather than
   * offered as dead ends, and with fewer than two left the box is not shown at
   * all, since "All" and the one mode would show the same thing. "All" is
   * always offered.
   */
  availableModes?: Set<string>;
}

/** The Mode filter's choices: "All", then each mode. */
export const MODE_OPTIONS: readonly RadioOption<Mode | null>[] = [
  { key: null, label: "All" },
  ...MODES.map((key) => ({ key, label: MODE_NAME[key] })),
];

/**
 * A Mode filter box whose choices navigate, keeping the other params. A mode
 * with no qualifying data is left out of the list unless it is the active one,
 * so the box can always show and reset what the URL holds.
 * @param props - Component props.
 * @param props.active - The active mode, or null for "All".
 * @param props.basePath - Page path the choices navigate to.
 * @param props.preservedParams - Query params to keep when switching mode.
 * @param props.availableModes - Modes with qualifying data (optional).
 * @returns The filter box, or null when fewer than two modes have data.
 */
export function ModeFilter({
  active,
  basePath,
  preservedParams,
  availableModes,
}: ModeFilterProps): JSX.Element | null {
  const offered = MODE_OPTIONS.filter(
    (m) => !m.key || m.key === active || !availableModes || availableModes.has(m.key),
  );
  if (active === null && offered.length < 3) return null;
  return (
    <UrlRadioFilter
      label="Mode"
      param="mode"
      options={offered}
      value={active}
      defaultKey={null}
      basePath={basePath}
      preservedParams={preservedParams}
    />
  );
}
