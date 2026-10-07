// src/lib/route/pattern.ts
// A route's directional stopping patterns. The GTFS shapes sync stores them nightly
// from AT's zip (see lib/feed/gtfs-trips.ts), so a route usually reads one row. A
// route with no stored row - the school routes the zip leaves out, or a new feed
// version the sync has not reached - is built from AT's API instead: its trips, then
// one stoptimes call per pattern, capped at MAX_PATTERNS to stay within the quota.
// Both paths group trips the same way (lib/route/pattern-groups.ts). Only stop
// order is available here, no road geometry. Results are cached daily by route.
import { routeIdsForSlug } from "@/lib/data";
import { DAY_REVALIDATE } from "@/lib/data/revalidate";
import { prisma } from "@/lib/db";
import { fetchAll } from "@/lib/feed/at-static";
import { unstable_cache } from "@/lib/mem-cache";
import { patternVariants, toRoutePattern, topPatternGroups } from "@/lib/route/pattern-groups";
import type { RoutePattern } from "@/types/api";

/** GTFS trip attributes (subset) from `/routes/{id}/trips`. */
interface TripAttr {
  trip_id: string;
  direction_id?: number | null;
  shape_id?: string | null;
  trip_headsign?: string | null;
}

/** GTFS stop-time attributes (subset) from `/trips/{id}/stoptimes`. */
interface StopTimeAttr {
  stop_id: string;
  stop_sequence: number;
}

/**
 * The pattern the shapes sync stored for a route version, or null when it has none.
 * @param routeId - AT's versioned route id.
 * @returns The stored pattern, or null.
 */
async function storedRoutePattern(routeId: string): Promise<RoutePattern | null> {
  const row = await prisma.routePattern.findUnique({
    where: { id: routeId },
    select: { variants: true },
  });
  if (!row || row.variants.length === 0) return null;
  return toRoutePattern(
    row.variants.map((v) => ({
      headsign: v.headsign,
      directionId: v.directionId,
      tripCount: v.tripCount,
      stopIds: v.stopIds,
      shapeId: v.shapeId,
    })),
  );
}

/**
 * Build a route's stopping patterns from AT's API: its trips grouped by
 * {@link topPatternGroups}, each kept group's stop order read from its
 * representative trip's stoptimes.
 * @param routeId - AT route id.
 * @returns Patterns grouped by direction, variants sorted most-frequent first.
 */
async function queryRoutePatternFromApi(routeId: string): Promise<RoutePattern> {
  const trips = await fetchAll<TripAttr>(`/routes/${encodeURIComponent(routeId)}/trips`);
  const groups = topPatternGroups(
    trips.map((t) => ({
      tripId: t.trip_id,
      directionId: t.direction_id ?? null,
      shapeId: t.shape_id ?? null,
      headsign: t.trip_headsign ?? null,
    })),
  );
  const stopIds = new Map(
    await Promise.all(
      groups.map(async (g) => {
        const stoptimes = await fetchAll<StopTimeAttr>(
          `/trips/${encodeURIComponent(g.tripId)}/stoptimes`,
        );
        const ordered = stoptimes
          .toSorted((a, b) => a.stop_sequence - b.stop_sequence)
          .map((s) => s.stop_id);
        return [g.tripId, ordered] as const;
      }),
    ),
  );
  return toRoutePattern(patternVariants(groups, (tripId) => stopIds.get(tripId)));
}

/**
 * Cached route stopping patterns (daily; the schedule is static): the stored row
 * when the sync has one, AT's API otherwise.
 * @param routeId - AT route id (a slug or a versioned id).
 * @returns Patterns grouped by direction.
 */
export async function getRoutePattern(routeId: string): Promise<RoutePattern> {
  // The schedule lives under the newest feed version's id; resolve a slug to it.
  // routeIdsForSlug never returns empty (it falls back to `[slug]`), so the
  // default only restates that contract for the type checker.
  const [latestId = routeId] = await routeIdsForSlug(routeId);
  return unstable_cache(
    async () => (await storedRoutePattern(latestId)) ?? queryRoutePatternFromApi(latestId),
    ["route-pattern", latestId],
    { revalidate: DAY_REVALIDATE },
  )();
}
