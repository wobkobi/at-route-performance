// src/components/filter/ModeUsageFilter.tsx
// The Mode box on a page that learns which modes ran only once its reads settle.

import { ModeFilter, type ModeFilterProps } from "@/components/filter/ModeFilter";
import { Suspense, type JSX } from "react";

/** Props for {@link ModeUsageFilter}. */
export interface ModeUsageFilterProps extends Omit<ModeFilterProps, "availableModes"> {
  /** The modes with data in the window, streamed; undefined offers every mode. */
  modes: Promise<Set<string> | undefined>;
}

/**
 * A {@link ModeFilter} that streams in its choices: until `modes` settles it
 * offers every mode, then drops the ones that did not run, so the box never
 * holds up the page and never offers a choice that empties the board.
 * @param props - Component props.
 * @param props.modes - The modes with data, streamed.
 * @param props.active - The active mode, or null for All.
 * @param props.basePath - Page path the choices navigate to.
 * @param props.preservedParams - Query params the choices keep.
 * @returns The box.
 */
export function ModeUsageFilter({ modes, ...box }: ModeUsageFilterProps): JSX.Element {
  return (
    <Suspense fallback={<ModeFilter {...box} />}>
      <SettledModeFilter {...box} modes={modes} />
    </Suspense>
  );
}

/**
 * The box once the modes are known.
 * @param props - Component props.
 * @param props.modes - The modes with data, streamed.
 * @returns The box.
 */
async function SettledModeFilter({ modes, ...box }: ModeUsageFilterProps): Promise<JSX.Element> {
  return <ModeFilter {...box} availableModes={await modes} />;
}
