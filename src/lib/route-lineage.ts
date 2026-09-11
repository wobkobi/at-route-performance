// src/lib/route-lineage.ts
/**
 * @description Links each City Rail Link train line back to the lines it
 * replaces on 13 September 2026, so a rename does not fork the archive. Route
 * ids change wholesale at the cutover - "STH" stops appearing in the feed and
 * "S-C" starts - which would otherwise strand years of DailyRouteSummary under a
 * slug that never receives another event, and start the replacement from zero.
 * Reads aggregate a line together with its predecessors, and a retired slug's
 * URL redirects to its successor.
 */

/** One line's succession across the CRL cutover. */
interface LineSuccession {
  /**
   * Post-CRL slug candidates, most likely first. AT publishes the codes as
   * "S-C"/"E-W"/"O-W" but has not yet published the GTFS `route_id`s, and its
   * ids are `<short name>-<version>` ("STH-201"), which a hyphenated code may
   * be flattened to avoid - so the unhyphenated form is a candidate too.
   */
  readonly to: readonly string[];
  /** Slugs retired at the cutover, whose history belongs to the new line. */
  readonly from: readonly string[];
}

/** The three CRL line successions. The Eastern and Western lines merge into one. */
const CRL_SUCCESSION: readonly LineSuccession[] = [
  { to: ["S-C", "SC"], from: ["STH"] },
  { to: ["E-W", "EW"], from: ["EAST", "WEST"] },
  { to: ["O-W", "OW"], from: ["ONE"] },
];

/**
 * The retired slugs whose performance history belongs to a line.
 * @param slug - A route slug (any case).
 * @returns Predecessor slugs, or an empty array for every non-rail route.
 */
export function predecessorSlugs(slug: string): string[] {
  const key = slug.toUpperCase();
  const match = CRL_SUCCESSION.find((s) => s.to.includes(key));
  return match ? [...match.from] : [];
}

/**
 * The slugs a retired line's URL should move to, most likely first. Callers pick
 * the first that exists, since which id AT publishes is not yet known.
 * @param slug - A route slug (any case).
 * @returns Successor slug candidates, or an empty array when the line still runs.
 */
export function successorSlugs(slug: string): string[] {
  const key = slug.toUpperCase();
  const match = CRL_SUCCESSION.find((s) => s.from.includes(key));
  return match ? [...match.to] : [];
}
