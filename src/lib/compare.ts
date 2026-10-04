// src/lib/compare.ts
// The compare page's pure parts: what it is comparing, read off the query
// string, which column wins each row, and the picker's matching. Client-safe.

import type { StopMatch } from "@/lib/data/stop-search";
import { searchFold } from "@/lib/format";
import { lineName } from "@/lib/route/line-name";
import type { RouteRow } from "@/types/api";

/** What the compare page lines up side by side. */
export type CompareKind = "routes" | "stops";

/** Most items one comparison holds: past four the columns stop fitting a laptop. */
export const MAX_COMPARE = 4;

/** Matches the picker lists under its search box. */
export const COMPARE_SEARCH_LIMIT = 10;

/** One route or stop the picker offers. */
export interface CompareCandidate {
  id: string;
  name: string;
  /** A second line: a route's line or long name, a stop's code. */
  detail: string | null;
  /** The route's badge and search fields, for a route candidate. */
  route?: Pick<RouteRow, "mode" | "shortName" | "longName" | "colour">;
  /** The route's on-time share over the window, so a pick can be weighed first. */
  onTimePct?: number | null;
}

/**
 * A stop search hit as a picker candidate.
 * @param m - The hit.
 * @returns The candidate.
 */
export function stopCandidate(m: StopMatch): CompareCandidate {
  return { id: m.id, name: m.name, detail: m.code ? `Stop ${m.code}` : "Station" };
}

/**
 * Route candidates matching a search: an exact short name first, then short
 * names that start with it, then any other match on the long name or the
 * published line or service name ("city link", "southern"). Text is folded by
 * {@link searchFold}, as on the Routes page, so case, macrons, spaces and
 * hyphens do not matter. The sort is stable, so within a tier the options keep
 * the order they came in (busiest first, as the page passes them).
 * @param options - Route candidates, each with its `route`.
 * @param q - The search text.
 * @param exclude - Ids already being compared.
 * @returns Up to {@link COMPARE_SEARCH_LIMIT} matches.
 */
export function matchRoutes(
  options: readonly CompareCandidate[],
  q: string,
  exclude: readonly string[],
): CompareCandidate[] {
  const text = searchFold(q);
  if (!text) return [];
  const skip = new Set(exclude.map((id) => id.toLowerCase()));
  /**
   * How well a route matches, lower first, or -1 for no match. The "|" keeps a
   * query from matching across two fields.
   * @param c - The candidate.
   * @returns The match tier.
   */
  const rank = (c: CompareCandidate): number => {
    const short = searchFold(c.route?.shortName ?? c.name);
    if (short === text) return 0;
    if (short.startsWith(text)) return 1;
    const line = c.route ? (lineName(c.route.mode, c.route.shortName) ?? "") : "";
    return searchFold([c.route?.longName ?? "", line].join("|")).includes(text) ? 2 : -1;
  };
  return options
    .filter((c) => !skip.has(c.id.toLowerCase()))
    .map((c) => ({ c, score: rank(c) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, COMPARE_SEARCH_LIMIT)
    .map(({ c }) => c);
}

/**
 * The kind from the `kind` param, routes unless it says stops.
 * @param raw - The `kind` param.
 * @returns The kind.
 */
export function parseCompareKind(raw: string | undefined): CompareKind {
  return raw === "stops" ? "stops" : "routes";
}

/**
 * The ids from the `ids` param: comma separated, trimmed, duplicates and blanks
 * dropped, first {@link MAX_COMPARE} kept in the order given.
 * @param raw - The `ids` param.
 * @returns The ids.
 */
export function parseCompareIds(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (id) seen.add(id);
    if (seen.size === MAX_COMPARE) break;
  }
  return [...seen];
}

/**
 * The `ids` param with one id added or removed, or null when that leaves none.
 * @param ids - The current ids.
 * @param id - The id to toggle.
 * @returns The new param value, or null for an empty comparison.
 */
export function toggleCompareId(ids: readonly string[], id: string): string | null {
  const next = ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id];
  return next.length === 0 ? null : next.slice(0, MAX_COMPARE).join(",");
}

/**
 * Which columns hold a row's best value: the highest when higher is better,
 * else the lowest. Nothing is marked with fewer than two values to weigh, or
 * when every value ties, since a mark on each column says nothing.
 * @param values - The row's value per column, null where unknown.
 * @param better - Whether a higher or a lower value wins.
 * @returns Indices of the winning columns.
 */
export function bestColumns(
  values: readonly (number | null)[],
  better: "high" | "low",
): Set<number> {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return new Set();
  const best = better === "high" ? Math.max(...known) : Math.min(...known);
  if (known.every((v) => v === best)) return new Set();
  return new Set(values.flatMap((v, i) => (v === best ? [i] : [])));
}
