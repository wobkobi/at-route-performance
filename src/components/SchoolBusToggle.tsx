"use client";
// src/components/SchoolBusToggle.tsx
// Filter box choosing whether school bus services are included.

import { FilterMenu, FilterOption } from "@/components/FilterMenu";
import { buildHref } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useId, type JSX } from "react";

/** Props for {@link SchoolBusToggle}. */
export interface SchoolBusToggleProps {
  /** Whether school buses are currently included. */
  active: boolean;
  /** Page path the choices navigate to. */
  basePath: string;
  /** Query params to preserve (the `school` param is set here). */
  preservedParams: Record<string, string>;
}

/**
 * A School buses filter box choosing whether school-service routes (`S###`)
 * count. Left out by default; including them adds `?school=1`, and the reset
 * takes it off again.
 * @param props - Component props.
 * @param props.active - Whether school buses are currently included.
 * @param props.basePath - Page path the choices navigate to.
 * @param props.preservedParams - Query params to keep when toggling.
 * @returns The filter box.
 */
export function SchoolBusToggle({
  active,
  basePath,
  preservedParams,
}: SchoolBusToggleProps): JSX.Element {
  const router = useRouter();
  const name = useId();
  /**
   * Navigate to the page with school buses in or out.
   * @param include - Whether to include them.
   */
  const choose = (include: boolean): void => {
    router.push(buildHref(basePath, { ...preservedParams, school: include ? "1" : undefined }), {
      scroll: false,
    });
  };
  return (
    <FilterMenu
      label="School buses"
      summary={active ? "Included" : null}
      onReset={() => choose(false)}
    >
      <FilterOption type="radio" name={name} checked={!active} onChange={() => choose(false)}>
        Leave out
      </FilterOption>
      <FilterOption type="radio" name={name} checked={active} onChange={() => choose(true)}>
        Include
      </FilterOption>
    </FilterMenu>
  );
}
