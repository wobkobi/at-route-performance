"use client";
// src/components/filter/SchoolBusToggle.tsx
// Filter box choosing whether school bus services are left out, included, or shown alone.

import { FilterMenu, FilterOption } from "@/components/filter/FilterMenu";
import {
  SCHOOL_FILTERS,
  schoolFilterParam,
  schoolFilterSummary,
  type SchoolFilter,
} from "@/lib/school-bus";
import { buildHref } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useId, type JSX } from "react";

/** Props for {@link SchoolBusToggle}. */
export interface SchoolBusToggleProps {
  /** The active choice. */
  value: SchoolFilter;
  /** Page path the choices navigate to. */
  basePath: string;
  /** Query params to preserve (the `school` param is set here). */
  preservedParams: Record<string, string>;
}

/**
 * A School buses filter box choosing how school-service routes (`S###`) count:
 * left out by default, included beside every other service (`?school=1`), or
 * shown alone (`?school=only`). The reset goes back to leaving them out.
 * @param props - Component props.
 * @param props.value - The active choice.
 * @param props.basePath - Page path the choices navigate to.
 * @param props.preservedParams - Query params to keep when choosing.
 * @returns The filter box.
 */
export function SchoolBusToggle({
  value,
  basePath,
  preservedParams,
}: SchoolBusToggleProps): JSX.Element {
  const router = useRouter();
  const name = useId();
  /**
   * Navigate to the page under a choice.
   * @param next - The choice.
   */
  const choose = (next: SchoolFilter): void => {
    router.push(buildHref(basePath, { ...preservedParams, school: schoolFilterParam(next) }), {
      scroll: false,
    });
  };
  return (
    <FilterMenu
      label="School buses"
      summary={schoolFilterSummary(value)}
      onReset={() => choose("exclude")}
    >
      {SCHOOL_FILTERS.map((f) => (
        <FilterOption
          key={f.key}
          type="radio"
          name={name}
          checked={value === f.key}
          onChange={() => choose(f.key)}
        >
          {f.label}
        </FilterOption>
      ))}
    </FilterMenu>
  );
}
