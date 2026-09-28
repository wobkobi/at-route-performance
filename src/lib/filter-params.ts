// src/lib/filter-params.ts
// What each filter chip row keeps in its links, so the filters on a page compose
// instead of resetting each other. Shared because the home page and the shame
// boards carry the same three filters and had each worked the cross-product out
// for themselves.

import type { DelayDirection } from "@/lib/rankings";

/** The three filters a board can carry, as the chip rows hold them. */
export interface CarriedFilters {
  /** Active mode, or null for every mode. */
  mode: string | null;
  /** Whether school services are included. */
  includeSchool: boolean;
  /** Active delay direction, or null for both. */
  dir: DelayDirection;
}

/**
 * The params each control keeps when it links: every other filter plus the
 * page's own view params, dropping only the param that control sets itself. A
 * control that kept its own param could not clear it, and one that dropped a
 * sibling's would silently widen a filter the reader had set.
 * @param filters - The active filters.
 * @param view - The view params every control keeps (the day, or window and
 *   period); undefined values are left out.
 * @returns One param set per control, keyed by the param it owns.
 */
export function preservedFilters(
  filters: CarriedFilters,
  view: Record<string, string | undefined>,
): Record<"mode" | "school" | "dir", Record<string, string>> {
  const all: Record<string, string | undefined> = {
    ...view,
    mode: filters.mode ?? undefined,
    school: filters.includeSchool ? "1" : undefined,
    dir: filters.dir ?? undefined,
  };
  /**
   * The full set minus one control's own param and any unset value.
   * @param key - The param the control sets itself.
   * @returns The params that control keeps.
   */
  const without = (key: string): Record<string, string> =>
    Object.fromEntries(
      Object.entries(all).filter((e): e is [string, string] => e[0] !== key && e[1] !== undefined),
    );
  return { mode: without("mode"), school: without("school"), dir: without("dir") };
}
