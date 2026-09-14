// src/lib/data/route-areas.ts
// Which areas of Auckland each route serves, for the Routes page filter. The
// schedule would need a stoptimes call per trip pattern per route, so the stops
// come from what each route actually served instead: the (route, stop) pairs in
// ArrivalEvent over the last week of completed service days. A week catches
// weekend-only and weekday-only services alike.
import { type AreaKey, routeAreas } from "@/lib/areas";
import { cachedForDay } from "@/lib/data/cache";
import { prisma, runCommand } from "@/lib/db";
import { unstable_cache } from "@/lib/mem-cache";
import { routeSlug } from "@/lib/route-slug";
import { nzServiceDayRange, nzServiceDayString, shiftWeek } from "@/lib/time";

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
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            {
              $match: {
                scheduledAt: {
                  $gte: { $date: range.start.toISOString() },
                  $lt: { $date: range.end.toISOString() },
                },
              },
            },
            { $group: { _id: "$routeId", stops: { $addToSet: "$stopId" } } },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: { _id: string; stops: string[] }[] } };
      const bySlug: Record<string, string[]> = {};
      for (const row of res.cursor.firstBatch) {
        const slug = routeSlug(row._id);
        bySlug[slug] = [...new Set([...(bySlug[slug] ?? []), ...row.stops])];
      }
      return bySlug;
    },
    ["route-stops-of-day", date],
    date,
    6 * 3600,
  );
}

/**
 * The areas each route served over the last week of completed service days,
 * keyed by route slug. A route with no arrival in that week has no entry, so it
 * matches no area filter. Cached for six hours on top of the per-day scans.
 * @returns Route slug to its areas, in display order.
 */
export async function getRouteAreas(): Promise<Record<string, AreaKey[]>> {
  const yesterday = shiftWeek(nzServiceDayString(), -1);
  return unstable_cache(
    async () => {
      const dates = Array.from({ length: LOOKBACK_DAYS }, (_, i) => shiftWeek(yesterday, -i));
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
      const out: Record<string, AreaKey[]> = {};
      for (const [slug, stops] of stopsBySlug) {
        const points = [...stops]
          .map((id) => coordById.get(id))
          .filter((c): c is NonNullable<typeof c> => c !== undefined);
        out[slug] = routeAreas(points);
      }
      return out;
    },
    ["route-areas", yesterday],
    { revalidate: 6 * 3600 },
  )();
}
