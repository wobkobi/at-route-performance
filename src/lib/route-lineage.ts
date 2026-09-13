// src/lib/route-lineage.ts
// Links each City Rail Link train line back to the lines it replaces on
// 13 September 2026, so the rename does not fork the archive. Route ids change
// wholesale at the cutover ("STH-201" stops appearing in the feed and "S-C-201"
// starts), which would otherwise strand years of DailyRouteSummary under a slug
// that never receives another event and start the replacement from zero. Reads
// aggregate a line together with its predecessors, cross-route boards fold a
// retired line's rows into its successor's, and a retired slug's URL redirects
// once the successor is running.
import { routeSlug, routeVersion } from "@/lib/route-slug";
import type { TopRouteRow } from "@/types/api";

/** One line's succession across the CRL cutover. */
interface LineSuccession {
  /** The post-CRL slug. AT publishes the ids as "S-C-201", "E-W-201", "O-W-201". */
  readonly to: string;
  /** Slugs retired at the cutover, whose history belongs to the new line. */
  readonly from: readonly string[];
}

/** The three CRL line successions. The Eastern and Western lines merge into one. */
const CRL_SUCCESSION: readonly LineSuccession[] = [
  { to: "S-C", from: ["STH"] },
  { to: "E-W", from: ["EAST", "WEST"] },
  { to: "O-W", from: ["ONE"] },
];

/**
 * The retired slugs whose performance history belongs to a line.
 * @param slug - A route slug (any case).
 * @returns Predecessor slugs, or an empty array for every non-rail route.
 */
export function predecessorSlugs(slug: string): string[] {
  const key = slug.toUpperCase();
  const match = CRL_SUCCESSION.find((s) => s.to === key);
  return match ? [...match.from] : [];
}

/**
 * The slug a retired line's URL moves to.
 * @param slug - A route slug (any case).
 * @returns The successor slug, or null when the line is not retired by the CRL.
 */
export function successorSlug(slug: string): string | null {
  const key = slug.toUpperCase();
  return CRL_SUCCESSION.find((s) => s.from.includes(key))?.to ?? null;
}

/**
 * Every post-CRL line slug, for callers that check the successors' state up
 * front (the directory asks which of them has carried traffic yet).
 * @returns The successor slugs.
 */
export function allSuccessorSlugs(): string[] {
  return CRL_SUCCESSION.map((s) => s.to);
}

/**
 * Keep exactly one of a retired line and its successor in a route directory.
 * AT publishes the successor's Route row in static GTFS days before the first
 * train runs, so listing every current row would offer an empty line ahead of
 * the cutover; and once the successor is running the retired line's URL
 * redirects, so listing it would offer a link that bounces. Every other row
 * passes through.
 * @param rows - Directory rows carrying full route ids.
 * @param running - Successor slugs that have carried traffic.
 * @returns The rows to list, in the input order.
 */
export function directoryLineageRows<T extends { id: string }>(
  rows: readonly T[],
  running: ReadonlySet<string>,
): T[] {
  return rows.filter((row) => {
    const slug = routeSlug(row.id);
    if (predecessorSlugs(slug).length > 0) return running.has(slug);
    const successor = successorSlug(slug);
    return successor === null || !running.has(successor);
  });
}

/** The averaged fields of a ranking row, each event-weighted when rows merge. */
const WEIGHTED_FIELDS = [
  "avg_delay_sec",
  "avg_abs_delay_sec",
  "on_time_pct",
  "early_pct",
  "late_pct",
] as const;

/**
 * Event-weighted mean of one averaged field across the rows being merged.
 * Rows without a value contribute nothing; the result is `undefined` when no
 * row carries the field at all (the optional `early_pct`/`late_pct` are absent
 * on the top-routes rows), `null` when every row that has it holds null, and
 * otherwise rounded to one decimal like the pipelines that produce the rows.
 * @param rows - The rows being merged.
 * @param field - The averaged field to combine.
 * @returns The combined value.
 */
function weightedMean(
  rows: readonly TopRouteRow[],
  field: (typeof WEIGHTED_FIELDS)[number],
): number | null | undefined {
  let present = false;
  let weight = 0;
  let sum = 0;
  for (const row of rows) {
    const value = row[field];
    if (value === undefined) continue;
    present = true;
    if (value === null) continue;
    weight += row.events;
    sum += value * row.events;
  }
  if (!present) return undefined;
  if (weight === 0) return null;
  return Math.round((sum / weight) * 10) / 10;
}

/**
 * Merge ranking rows that belong to one line. Two cases produce more than one
 * row per line: a feed-version republish inside the window ("501-217" and
 * "501-218" both run in a week that spans a schedule change), and the CRL
 * cutover, where a retired line's rows join its successor's once the successor
 * has rows of its own in the window. A retired line with no successor row is
 * left alone, so nothing changes before the cutover. Events are summed and the
 * averages and percentages are event-weighted; the surviving row keeps the id,
 * name, mode and colour of the successor's (or the newest) version. Rows of
 * unrelated routes pass through untouched, and the first-seen order is kept.
 * @param rows - Per-route rows keyed by full route id.
 * @returns One row per line.
 */
export function foldLineageRows(rows: readonly TopRouteRow[]): TopRouteRow[] {
  const slugsPresent = new Set(rows.map((row) => routeSlug(row.route_id)));
  const groups = new Map<string, TopRouteRow[]>();
  for (const row of rows) {
    const slug = routeSlug(row.route_id);
    const successor = successorSlug(slug);
    const key = successor !== null && slugsPresent.has(successor) ? successor : slug;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  return [...groups].map(([key, group]) => {
    const [only] = group;
    if (group.length === 1 && only) return only;
    // The line's own newest version names the merged row: a predecessor's
    // version number never outranks it because the key matches only the
    // successor's rows.
    const head = group.reduce((best, row) =>
      routeSlug(row.route_id) === key &&
      (routeSlug(best.route_id) !== key || routeVersion(row.route_id) > routeVersion(best.route_id))
        ? row
        : best,
    );
    const merged: TopRouteRow = {
      ...head,
      events: group.reduce((n, row) => n + row.events, 0),
    };
    for (const field of WEIGHTED_FIELDS) {
      const value = weightedMean(group, field);
      if (value !== undefined) merged[field] = value;
    }
    return merged;
  });
}
