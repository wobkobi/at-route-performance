// src/lib/data/network-lines.ts
// The road geometry the live map draws under its vehicle dots: one coarse
// polyline per route, so a dot sits on the road its run follows rather than
// floating on the basemap.
//
// One line per route, not per direction or per variant: the two directions drive
// the same road, and drawn together they only thicken it. A single route's map
// offsets them either side because there the direction is the subject; here the
// subject is where the network goes.

import { getRouteModeMap } from "@/lib/data/routes";
import { prisma, runCommand } from "@/lib/db";
import { unstable_cache } from "@/lib/mem-cache";
import { simplifyPath } from "@/lib/route-geo";
import { routeSlug } from "@/lib/route-slug";
import type { NetworkLine } from "@/types/api";

/** How far from the line a bend may sit before the overlay drops it, in metres. */
const OVERVIEW_TOLERANCE_M = 30;

/** Rounding factor for the wire: five decimal places, about a metre. */
const WIRE_SCALE = 1e5;

/** One route's busiest shape, from the trip metadata. */
interface RouteShape {
  /** The route id the trips belong to. */
  _id: string;
  shapeId: string;
  trips: number;
}

/** The line held for a route slug while the busiest feed version is chosen. */
interface HeldLine {
  shapeId: string;
  trips: number;
  mode: NetworkLine["mode"];
}

/**
 * The shape each route's runs actually drive, as `routeId > shapeId`. A route
 * publishes several shapes - a short-working, a diversion, a peak-only tail - so
 * the one carrying the most trips is the one that reads as the route.
 *
 * Grouped in the database rather than read row by row: the trip metadata holds a
 * row per published trip, which is tens of thousands, and this returns one per
 * route.
 * @returns One row per route id, with its busiest shape.
 */
async function busiestShapePerRoute(): Promise<RouteShape[]> {
  const res = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "tripMeta",
      pipeline: [
        { $match: { shapeId: { $type: "string" }, routeId: { $type: "string" } } },
        { $group: { _id: { routeId: "$routeId", shapeId: "$shapeId" }, trips: { $sum: 1 } } },
        // Sorted before the second group so `$first` is the busiest shape.
        { $sort: { trips: -1 } },
        {
          $group: {
            _id: "$_id.routeId",
            shapeId: { $first: "$_id.shapeId" },
            trips: { $first: "$trips" },
          },
        },
      ],
      cursor: {},
    }),
  )) as unknown as { cursor: { firstBatch: RouteShape[] } };
  return res.cursor.firstBatch;
}

/**
 * Every route's road path, thinned for a whole-network overlay and tagged with
 * its mode. Cached for a day: shapes and trip metadata only change when the
 * GTFS sync runs.
 *
 * Feed-version republishes are folded to one line per slug - both versions of a
 * republished route drive the same road - keeping whichever version has the most
 * trips, which is the current one outside a cutover.
 * @returns One {@link NetworkLine} per route, in no particular order.
 */
export async function getNetworkLines(): Promise<NetworkLine[]> {
  return unstable_cache(
    async () => {
      const [rows, modes] = await Promise.all([busiestShapePerRoute(), getRouteModeMap()]);

      // Keep one row per slug, and only where the route's mode is known: a line
      // the mode filter cannot place is a line the map cannot hide.
      const bySlug = new Map<string, HeldLine>();
      for (const row of rows) {
        const mode = modes.get(row._id);
        if (mode === undefined) continue;
        const slug = routeSlug(row._id);
        const held = bySlug.get(slug);
        if (held !== undefined && held.trips >= row.trips) continue;
        bySlug.set(slug, { shapeId: row.shapeId, trips: row.trips, mode });
      }

      const modeByShape = new Map<string, NetworkLine["mode"]>();
      for (const held of bySlug.values()) modeByShape.set(held.shapeId, held.mode);
      if (modeByShape.size === 0) return [];

      // The whole collection, as the off-route step reads it: about a thousand
      // documents, against several hundred ids in a filter.
      const shapes = await prisma.shape.findMany({ select: { id: true, points: true } });
      const lines: NetworkLine[] = [];
      for (const shape of shapes) {
        const mode = modeByShape.get(shape.id);
        if (mode === undefined) continue;
        // Shapes are stored `[lon, lat]` (GeoJSON order); a map wants `[lat, lon]`.
        // `points` is a Json column, so its shape is checked rather than trusted:
        // one malformed document would otherwise cost the whole underlay.
        const stored = shape.points as unknown as [number, number][] | null;
        if (!Array.isArray(stored) || stored.length < 2) continue;
        const thinned = simplifyPath(
          stored.map(([lon, lat]): [number, number] => [lat, lon]),
          OVERVIEW_TOLERANCE_M,
        );
        if (thinned.length < 2) continue;
        const path: number[] = [];
        for (const [lat, lon] of thinned) {
          path.push(Math.round(lat * WIRE_SCALE) / WIRE_SCALE);
          path.push(Math.round(lon * WIRE_SCALE) / WIRE_SCALE);
        }
        lines.push({ mode, path });
      }
      return lines;
    },
    ["network-lines-v1"],
    { revalidate: 86_400 },
  )();
}
