// src/lib/route/pattern-groups.ts
// How a route's trips become its stopping patterns, shared by the GTFS shapes sync
// (which stores them from the zip) and the AT API fallback (for a route the sync has
// not stored), so both build the same pattern from the same trips. Trips are grouped
// by (direction_id, shape_id); each group's stop order comes from one representative
// trip, and only the most-frequent groups are kept.
import type { RoutePattern, RouteVariant } from "@/types/api";

/**
 * Cap on how many distinct patterns a route keeps. On the API path each one costs a
 * stoptimes call, so resolving only the most-frequent keeps well within AT's quota;
 * the sync keeps the same cap so a stored pattern matches a fetched one.
 */
export const MAX_PATTERNS = 8;

/** The trip fields a pattern is grouped by. */
export interface PatternTrip {
  tripId: string;
  directionId: number | null;
  shapeId: string | null;
  headsign: string | null;
}

/** One (direction, shape) group: its first trip stands in for the rest. */
export interface PatternGroup {
  directionId: number;
  headsign: string | null;
  tripId: string;
  shapeId: string | null;
  count: number;
}

/**
 * Group trips by (direction, shape) and keep the {@link MAX_PATTERNS} most frequent.
 * A trip with no direction counts as direction 0.
 * @param trips - The route's trips, in feed order (the first of each group represents it).
 * @returns The kept groups, most frequent first.
 */
export function topPatternGroups(trips: Iterable<PatternTrip>): PatternGroup[] {
  const groups = new Map<string, PatternGroup>();
  for (const t of trips) {
    if (!t.tripId) continue;
    const directionId = t.directionId ?? 0;
    const key = `${directionId}::${t.shapeId ?? ""}`;
    const existing = groups.get(key);
    if (existing) existing.count++;
    else
      groups.set(key, {
        directionId,
        headsign: t.headsign,
        tripId: t.tripId,
        shapeId: t.shapeId,
        count: 1,
      });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, MAX_PATTERNS);
}

/**
 * Turn groups and their representative trips' stop orders into variants. A group
 * whose trip has fewer than two stops (or none read) draws nothing and is dropped.
 * @param groups - From {@link topPatternGroups}.
 * @param stopIdsOf - A representative trip's stops in sequence order, or undefined when unread.
 * @returns One variant per usable group.
 */
export function patternVariants(
  groups: readonly PatternGroup[],
  stopIdsOf: (tripId: string) => string[] | undefined,
): RouteVariant[] {
  const out: RouteVariant[] = [];
  for (const g of groups) {
    const stopIds = stopIdsOf(g.tripId);
    if (!stopIds || stopIds.length < 2) continue;
    out.push({
      headsign: g.headsign,
      directionId: g.directionId,
      tripCount: g.count,
      stopIds,
      shapeId: g.shapeId,
    });
  }
  return out;
}

/**
 * Gather variants into a pattern by direction, each direction's variants most
 * frequent first.
 * @param variants - From {@link patternVariants}.
 * @returns The route's pattern.
 */
export function toRoutePattern(variants: readonly RouteVariant[]): RoutePattern {
  const directions: RoutePattern["directions"] = {};
  for (const v of variants) (directions[v.directionId] ??= { variants: [] }).variants.push(v);
  for (const d of Object.values(directions)) d.variants.sort((a, b) => b.tripCount - a.tripCount);
  return { directions };
}
