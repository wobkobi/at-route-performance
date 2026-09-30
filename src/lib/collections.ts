// Grouping, tallying and median helpers shared across the data and view code.

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
