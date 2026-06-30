// src/lib/route-pattern.ts
/**
 * @description Build a route's directional stopping patterns from the AT GTFS
 * schedule. Trips are grouped by `(direction_id, shape_id)`; each group's ordered
 * stop list is resolved from one representative trip's stoptimes. AT exposes no
 * route-shape endpoint, so every pattern costs a separate stoptimes call - hence
 * resolving only the most-frequent patterns (capped at MAX_PATTERNS) to stay
 * within the API quota. Only stop order is available here, no road geometry.
 * Results are cached daily and keyed by route, since the schedule is static.
 */
import { fetchAll } from "@/lib/at-static";
import { routeIdsForSlug } from "@/lib/data";
import { unstable_cache } from "@/lib/mem-cache";
import type { RoutePattern, RouteVariant } from "@/types/api";

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
 * Cap on how many distinct patterns to resolve stop orders for. AT exposes no
 * route-shape geometry endpoint, so each pattern costs one stoptimes call;
 * resolving only the most-frequent patterns keeps well within the API quota.
 */
const MAX_PATTERNS = 8;

/**
 * Build a route's stopping patterns per direction from the AT GTFS schedule.
 * Trips are grouped by `(direction_id, shape_id)`; the most-frequent patterns
 * each contribute one ordered stop list (resolved from a representative trip's
 * stoptimes). No road geometry is available, only stop order.
 * @param routeId - AT route id.
 * @returns Patterns grouped by direction, variants sorted most-frequent first.
 */
async function queryRoutePattern(routeId: string): Promise<RoutePattern> {
  const trips = await fetchAll<TripAttr>(`/routes/${encodeURIComponent(routeId)}/trips`);

  // Group trips by (direction, shape); keep a representative trip and a count.
  const groups = new Map<
    string,
    {
      directionId: number;
      headsign: string | null;
      tripId: string;
      shapeId: string | null;
      count: number;
    }
  >();
  for (const t of trips) {
    if (!t.trip_id) continue;
    const directionId = t.direction_id ?? 0;
    const key = `${directionId}::${t.shape_id ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
    } else {
      groups.set(key, {
        directionId,
        headsign: t.trip_headsign ?? null,
        tripId: t.trip_id,
        shapeId: t.shape_id ?? null,
        count: 1,
      });
    }
  }

  // Resolve stop order for the most-frequent patterns only (quota guard).
  const topGroups = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, MAX_PATTERNS);

  const directions: Record<number, { variants: RouteVariant[] }> = {};
  await Promise.all(
    topGroups.map(async (g) => {
      const stoptimes = await fetchAll<StopTimeAttr>(
        `/trips/${encodeURIComponent(g.tripId)}/stoptimes`,
      );
      const stopIds = stoptimes
        .slice()
        .sort((a, b) => a.stop_sequence - b.stop_sequence)
        .map((s) => s.stop_id);
      if (stopIds.length < 2) return;
      (directions[g.directionId] ??= { variants: [] }).variants.push({
        headsign: g.headsign,
        directionId: g.directionId,
        tripCount: g.count,
        stopIds,
        shapeId: g.shapeId,
      });
    }),
  );

  for (const d of Object.values(directions)) {
    d.variants.sort((a, b) => b.tripCount - a.tripCount);
  }
  return { directions };
}

/**
 * Cached route stopping patterns (daily; the schedule is static). Keyed by
 * route so a handful of viewed routes per day stay well within AT's quota.
 * @param routeId - AT route id.
 * @returns Patterns grouped by direction.
 */
export async function getRoutePattern(routeId: string): Promise<RoutePattern> {
  // The schedule lives under the newest feed version's id; resolve a slug to it.
  const [latestId] = await routeIdsForSlug(routeId);
  return unstable_cache(() => queryRoutePattern(latestId), ["route-pattern", latestId], {
    revalidate: 86_400,
  })();
}
