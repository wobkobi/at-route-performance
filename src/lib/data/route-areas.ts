// src/lib/data/route-areas.ts
// Which areas and fare zones each route serves, for the Routes page filters. The
// schedule would need a stoptimes call per trip pattern per route, so the stops
// come from what each route actually served instead: the (route, stop) pairs in
// ArrivalEvent over the last week of completed service days. A week catches
// weekend-only and weekday-only services alike.
import { cachedForDay } from "@/lib/data/cache";
import { aggregateRows, dateWindow } from "@/lib/data/raw";
import { SIX_HOUR_REVALIDATE } from "@/lib/data/revalidate";
import { prisma } from "@/lib/db";
import { type AreaKey, routeAreas } from "@/lib/geo/areas";
import { routeFareZones } from "@/lib/geo/fare-zone-geo";
import type { FareZoneKey } from "@/lib/geo/fare-zones";
import { unstable_cache } from "@/lib/mem-cache";
import { routeSlug } from "@/lib/route/slug";
import { nzServiceDayRange, nzServiceDayString, shiftDays } from "@/lib/time/service-day";

/** Completed service days the areas are drawn from. */
const LOOKBACK_DAYS = 7;

/**
 * The stops each route recorded an arrival at on one service day, grouped by
 * route slug. One scan of the day on the `scheduledAt` index, the same size as
 * the live rankings day scan, cached under the day so each day is read once.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns Route slug to the stop ids it served that day.
 */
function routeStopsOfDay(date: string): Promise<Record<string, string[]>> {
  return cachedForDay(
    async () => {
      const range = nzServiceDayRange(date);
      const res = await aggregateRows<{ _id: string; stops: string[] }>("ArrivalEvent", [
        {
          $match: {
            scheduledAt: dateWindow(range),
          },
        },
        { $group: { _id: "$routeId", stops: { $addToSet: "$stopId" } } },
      ]);
      const bySlug: Record<string, string[]> = {};
      for (const row of res) {
        const slug = routeSlug(row._id);
        bySlug[slug] = [...new Set([...(bySlug[slug] ?? []), ...row.stops])];
      }
      return bySlug;
    },
    ["route-stops-of-day", date],
    date,
    SIX_HOUR_REVALIDATE,
  );
}

/** Each route's areas and fare zones, keyed by route slug. */
export interface RouteGeography {
  areas: Record<string, AreaKey[]>;
  zones: Record<string, FareZoneKey[]>;
}

/**
 * The areas and fare zones each route served over the last week of completed
 * service days, keyed by route slug; both are placed from the same stops, so
 * they come from one pass. A route with no arrival in that week has no entry,
 * so it matches no area or zone filter. Cached for six hours on top of the
 * per-day scans.
 * @returns Route slug to its areas and to its zones, each in display order.
 */
export async function getRouteGeography(): Promise<RouteGeography> {
  const yesterday = shiftDays(nzServiceDayString(), -1);
  return unstable_cache(
    async () => {
      const dates = Array.from({ length: LOOKBACK_DAYS }, (_, i) => shiftDays(yesterday, -i));
      const days = await Promise.all(dates.map(routeStopsOfDay));
      const stopsBySlug = new Map<string, Set<string>>();
      for (const day of days) {
        for (const [slug, stops] of Object.entries(day)) {
          const set = stopsBySlug.get(slug) ?? new Set<string>();
          for (const id of stops) set.add(id);
          stopsBySlug.set(slug, set);
        }
      }
      const allStops = [...new Set([...stopsBySlug.values()].flatMap((s) => [...s]))];
      const coords = await prisma.stop.findMany({
        where: { id: { in: allStops } },
        select: { id: true, lat: true, lon: true },
      });
      const coordById = new Map(coords.map((c) => [c.id, c]));
      const out: RouteGeography = { areas: {}, zones: {} };
      for (const [slug, stops] of stopsBySlug) {
        const points = [...stops]
          .map((id) => coordById.get(id))
          .filter((c): c is NonNullable<typeof c> => c !== undefined);
        out.areas[slug] = routeAreas(points);
        out.zones[slug] = routeFareZones(points);
      }
      return out;
    },
    ["route-geography", yesterday],
    { revalidate: SIX_HOUR_REVALIDATE },
  )();
}
