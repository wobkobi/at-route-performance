// src/lib/page/filter-params.ts
// Which query params a link carries: between sections, across a window switch,
// from one chip row to the next, and back to a list the reader came from. One
// place, so every control that carries params agrees on which ones.

import type { DelayDirection } from "@/lib/rankings";
import { schoolFilterParam, type SchoolFilter } from "@/lib/school-bus";

/** The date params: which window, day and period a page reads. */
export const VIEW_PARAMS = ["window", "day", "period"] as const;

/**
 * Params every section reads with the same meaning, so the site nav carries
 * them between sections. `dir` stays behind: it is late or early on the
 * Overview but a sort direction on Routes and a travel direction on a route page.
 */
export const SECTION_PARAMS = [...VIEW_PARAMS, "mode", "school"] as const;

/** The query param holding how many rows a show-more list is showing. */
export const SHOWN_PARAM = "show";

/**
 * How the vehicles list was left: its filters, sort and length. A vehicle page
 * carries these on every link that stays on it, so its back link returns to the
 * same list rather than the default board.
 */
export const VEHICLE_LIST_PARAMS = ["mode", "school", "op", "sort", "rev", SHOWN_PARAM] as const;

/**
 * The named params that are set, in the order named. Only non-empty strings
 * carry; a param repeated in a query yields its first value.
 * @param sp - A page's search params, or a URL's query.
 * @param keys - The params to keep.
 * @returns The kept params.
 */
export function pickParams(
  sp: URLSearchParams | object,
  keys: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v: unknown =
      sp instanceof URLSearchParams ? sp.get(k) : (sp as Record<string, unknown>)[k];
    if (typeof v === "string" && v !== "") out[k] = v;
  }
  return out;
}

/**
 * Every param in a query except the named ones.
 * @param sp - The query.
 * @param drop - The params to leave out.
 * @returns The rest, first value per param.
 */
export function omitParams(sp: URLSearchParams, drop: readonly string[]): Record<string, string> {
  return Object.fromEntries([...sp.entries()].filter(([k]) => !drop.includes(k)));
}

/** The three filters a board can carry, as the chip rows hold them. */
export interface CarriedFilters {
  /** Active mode, or null for every mode. */
  mode: string | null;
  /** Which school services count. */
  schools: SchoolFilter;
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
    school: schoolFilterParam(filters.schools),
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
