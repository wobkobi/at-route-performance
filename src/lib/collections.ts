// Grouping, tallying and median helpers shared across the data and view code,
// plus lookups over the fixed key-and-label option lists the filters show.

/**
 * Append a value to a key's list, starting the list on first use. Mutates the
 * list in place, so a loop filling a map stays linear.
 * @param map - The map of lists.
 * @param key - The key to file under.
 * @param value - The value to append.
 */
export function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Add to a key's running total, starting from zero.
 * @param map - The map of totals.
 * @param key - The key to add to.
 * @param n - The amount; one when omitted, for a count.
 */
export function addTo<K>(map: Map<K, number>, key: K, n = 1): void {
  map.set(key, (map.get(key) ?? 0) + n);
}

/**
 * Group items by a derived key, keeping each group in input order.
 * @param items - The items.
 * @param keyOf - Derives an item's key.
 * @returns Key to the items that share it, keys in first-seen order.
 */
export function groupBy<T, K>(items: Iterable<T>, keyOf: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) pushTo(out, keyOf(item), item);
  return out;
}

/**
 * Count items by a derived key.
 * @param items - The items.
 * @param keyOf - Derives an item's key.
 * @returns Key to how many items share it.
 */
export function countBy<T, K>(items: Iterable<T>, keyOf: (item: T) => K): Map<K, number> {
  const out = new Map<K, number>();
  for (const item of items) addTo(out, keyOf(item));
  return out;
}

/**
 * Total a figure by a derived key, for weighted tallies (arrivals per mode,
 * cancellations per route) that {@link countBy} would count as one each.
 * @param items - The items.
 * @param keyOf - Derives an item's key.
 * @param valueOf - The figure an item adds.
 * @returns Key to the summed figure.
 */
export function sumBy<T, K>(
  items: Iterable<T>,
  keyOf: (item: T) => K,
  valueOf: (item: T) => number,
): Map<K, number> {
  const out = new Map<K, number>();
  for (const item of items) addTo(out, keyOf(item), valueOf(item));
  return out;
}

/**
 * The median of a list of numbers. An even-length list takes the mean of its
 * two middle values by default; `"upper"` takes the upper of the two instead,
 * which is always one of the inputs - the rule the ghost pass's database
 * aggregation uses, so the in-memory and stored medians pick the same reading.
 * @param values - The numbers, in any order.
 * @param even - How an even-length list resolves.
 * @returns The median, or null for an empty list.
 */
export function median(values: readonly number[], even: "mean" | "upper" = "mean"): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid]!;
  if (sorted.length % 2 === 1 || even === "upper") return upper;
  return (sorted[mid - 1]! + upper) / 2;
}

/** One choice in a fixed option list: its query key and the label it shows as. */
export interface KeyedLabel<K extends string> {
  /** The key, as it appears in a query param. */
  key: K;
  /** The label shown for it. */
  label: string;
}

/**
 * An option list as a key-to-label record.
 * @param list - The options.
 * @returns Each key's label.
 */
export function labelsByKey<K extends string>(list: readonly KeyedLabel<K>[]): Record<K, string> {
  return Object.fromEntries(list.map((o) => [o.key, o.label])) as Record<K, string>;
}

/**
 * Whether a string is one of a list's keys.
 * @param list - The options.
 * @param value - The candidate, e.g. from a query param.
 * @returns True when it names an option.
 */
export function isKeyOf<K extends string>(
  list: readonly KeyedLabel<K>[],
  value: string | null | undefined,
): value is K {
  return list.some((o) => o.key === value);
}

/**
 * The label of one key.
 * @param list - The options.
 * @param key - The key, or null for none.
 * @returns Its label, or undefined when the key is not in the list.
 */
export function labelOf<K extends string>(
  list: readonly KeyedLabel<K>[],
  key: K | null | undefined,
): string | undefined {
  return list.find((o) => o.key === key)?.label;
}

/**
 * The labels of the chosen keys, in the list's order rather than the order
 * they were chosen, so a summary reads the same however the reader got there.
 * @param list - The options.
 * @param keys - The chosen keys.
 * @returns Their labels.
 */
export function labelsOf<K extends string>(
  list: readonly KeyedLabel<K>[],
  keys: readonly K[],
): string[] {
  return list.filter((o) => keys.includes(o.key)).map((o) => o.label);
}
