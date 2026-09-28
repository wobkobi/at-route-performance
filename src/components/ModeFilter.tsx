"use client";
// src/components/ModeFilter.tsx
// Filter box narrowing a page by transport mode - bus, train, ferry, or all.

import { FilterMenu, FilterOption } from "@/components/FilterMenu";
import { buildHref } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useId, type JSX } from "react";

/** A transport mode, or null for "All". */
export type ModeFilterValue = "BUS" | "TRAIN" | "FERRY" | null;

/** Props for {@link ModeFilter}. */
export interface ModeFilterProps {
  /** Currently active mode, or null for "All". */
  active: ModeFilterValue;
  /** Page path the choices navigate to. */
  basePath: string;
  /** Query params to preserve on the way (the `mode` param is set here). */
  preservedParams: Record<string, string>;
  /**
   * Set of mode keys that have qualifying data for the current period. When
   * provided, modes not in the set are left out of the list rather than
   * offered as dead ends. "All" is always offered.
   */
  availableModes?: Set<string>;
}

const MODES: { key: ModeFilterValue; label: string }[] = [
  { key: null, label: "All" },
  { key: "BUS", label: "Bus" },
  { key: "TRAIN", label: "Train" },
  { key: "FERRY", label: "Ferry" },
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
 * @returns The filter box.
 */
export function ModeFilter({
  active,
  basePath,
  preservedParams,
  availableModes,
}: ModeFilterProps): JSX.Element {
  const router = useRouter();
  const name = useId();
  /**
   * Navigate to the page on a mode.
   * @param key - The mode, or null for every mode.
   */
  const choose = (key: ModeFilterValue): void => {
    router.push(buildHref(basePath, { ...preservedParams, mode: key ?? undefined }), {
      scroll: false,
    });
  };
  const offered = MODES.filter(
    (m) => !m.key || m.key === active || !availableModes || availableModes.has(m.key),
  );
  return (
    <FilterMenu
      label="Mode"
      summary={MODES.find((m) => m.key !== null && m.key === active)?.label ?? null}
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
