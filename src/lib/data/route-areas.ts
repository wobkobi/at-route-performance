// src/lib/data/route-areas.ts
// Which areas and fare zones each route serves, for the Routes page filters. The
// schedule would need a stoptimes call per trip pattern per route, so the stops
// come from what each route actually served instead: the (route, stop) pairs in
// ArrivalEvent over the last week of completed service days. A week catches
// weekend-only and weekday-only services alike.
import { cachedForDay } from "@/lib/data/cache";
import { aggregateRows, dateWindow, findRows } from "@/lib/data/raw";
import { SIX_HOUR_REVALIDATE } from "@/lib/data/revalidate";
import { type AreaKey, routeAreas } from "@/lib/geo/areas";
import { fareZonesOf, zonesServed } from "@/lib/geo/fare-zone-geo";
import type { FareZoneKey } from "@/lib/geo/fare-zones";
import { memCache } from "@/lib/mem-cache";
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

/** A stop's position as the raw find returns it. */
interface StopPoint {
  _id: string;
  lat: number;
  lon: number;
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
 * so it matches no area or zone filter. Held in memory for six hours on top of the
 * per-day entries, rather than in the Data Cache: a Data Cache entry around the day
 * reads would skip their cached values and scan all seven days each time it missed.
 * @returns Route slug to its areas and to its zones, each in display order.
 */
export async function getRouteGeography(): Promise<RouteGeography> {
  const yesterday = shiftDays(nzServiceDayString(), -1);
  return memCache(`route-geography:${yesterday}`, SIX_HOUR_REVALIDATE, async () => {
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
    // A raw find, not Prisma's `in`: the week's stops are nearly every stop on the
    // network, and Prisma's form of that lookup took over five seconds (see findRows).
    const coords = await findRows<StopPoint>(
      "Stop",
      { _id: { $in: allStops } },
      { lat: 1, lon: 1 },
    );
    // Each stop is placed once: most stops serve several routes.
    const placed = new Map(
      coords.map((c) => [c._id, { point: c, zones: fareZonesOf(c.lat, c.lon) }]),
    );
    const out: RouteGeography = { areas: {}, zones: {} };
    for (const [slug, stops] of stopsBySlug) {
      const shown = [...stops]
        .map((id) => placed.get(id))
        .filter((p): p is NonNullable<typeof p> => p !== undefined);
      out.areas[slug] = routeAreas(shown.map((p) => p.point));
      out.zones[slug] = zonesServed(shown.map((p) => p.zones));
    }
    return out;
  });
}
