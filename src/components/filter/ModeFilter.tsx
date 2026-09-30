"use client";
// src/components/filter/ModeFilter.tsx
// Filter box narrowing a page by transport mode - bus, train, ferry, or all.

import { FilterMenu, FilterOption } from "@/components/filter/FilterMenu";
import { MODE_NAME, MODES, type Mode } from "@/lib/mode";
import { buildHref } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useId, type JSX } from "react";

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

/** The choices: "All", then each mode. */
const OPTIONS: { key: Mode | null; label: string }[] = [
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
  const router = useRouter();
  const name = useId();
  /**
   * Navigate to the page on a mode.
   * @param key - The mode, or null for every mode.
   */
  const choose = (key: Mode | null): void => {
    router.push(buildHref(basePath, { ...preservedParams, mode: key ?? undefined }), {
      scroll: false,
    });
  };
  const offered = OPTIONS.filter(
    (m) => !m.key || m.key === active || !availableModes || availableModes.has(m.key),
  );
  // "All" plus one mode is no choice; an active mode stays, so it can be cleared.
  if (active === null && offered.length < 3) return null;
  return (
    <FilterMenu
      label="Mode"
      summary={OPTIONS.find((m) => m.key !== null && m.key === active)?.label ?? null}
      onReset={() => choose(null)}
    >
      {offered.map((m) => (
        <FilterOption
          key={m.label}
          type="radio"
          name={name}
          checked={active === m.key}
          onChange={() => choose(m.key)}
        >
          {m.label}
        </FilterOption>
      ))}
    </FilterMenu>
  );
}
