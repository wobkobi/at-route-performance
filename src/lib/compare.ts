// src/lib/compare.ts
// The compare page's pure parts: what it is comparing, read off the query
// string, and which column wins each row. Client-safe.

/** What the compare page lines up side by side. */
export type CompareKind = "routes" | "stops";

/** Most items one comparison holds: past four the columns stop fitting a laptop. */
export const MAX_COMPARE = 4;

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
