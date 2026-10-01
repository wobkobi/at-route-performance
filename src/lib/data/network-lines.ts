// src/lib/data/network-lines.ts
// The road geometry the live map draws under its vehicle dots: coarse polylines
// per route, so a dot sits on the road its run follows rather than floating on
// the basemap.
//
// One line per route, not per direction: the two directions drive the same
// road, and drawn together they only thicken it. A single route's map offsets
// them either side because there the direction is the subject; here the subject
// is where the network goes. A route with branches or a long tail draws each
// once (src/lib/map/route-branches.ts), and routes of different colours on one
// road are set side by side (src/lib/map/shared-roads.ts).

import { aggregateRows } from "@/lib/data/raw";
import { getDirectoryRoutes } from "@/lib/data/routes";
import { prisma } from "@/lib/db";
import { type RouteShape, routePaths } from "@/lib/map/route-branches";
import { laneRuns } from "@/lib/map/shared-roads";
import { unstable_cache } from "@/lib/mem-cache";
import { routeColour } from "@/lib/route/colour";
import { lineName } from "@/lib/route/line-name";
import { routeSlug } from "@/lib/route/slug";
import type { NetworkLine } from "@/types/api";

/** How far from the line a bend may sit before the overlay drops it, in metres. */
const OVERVIEW_TOLERANCE_M = 30;

/** Rounding factor for the wire: five decimal places, about a metre. */
const WIRE_SCALE = 1e5;

/** Draw order, bottom first: the many bus roads under the few rail and ferry lines. */
const MODE_ORDER: Record<NetworkLine["mode"], number> = { BUS: 0, FERRY: 1, TRAIN: 2 };

/** How many published trips of one route follow one shape. */
interface RouteShapeTrips {
  _id: { routeId: string; shapeId: string };
  trips: number;
}

/** A route slug's stored shape and how many trips follow it. */
interface HeldShape {
  shapeId: string;
  trips: number;
}

/** The line held for a route slug while its shapes are gathered. */
interface HeldLine {
  shapes: HeldShape[];
  /** The busiest single shape's trips so far, which picks the name and colour. */
  top: number;
  name: string | null;
  mode: NetworkLine["mode"];
  colour: string;
}

/**
 * Trip counts per route and shape. A route publishes several shapes - a
 * short-working, a diversion, a branch, a peak-only tail - and between them they
 * draw the route. Every pair comes back because a shape the sync never stored (a
 * new feed version) leaves the route to its others rather than off the map.
 *
 * Grouped in the database rather than read row by row: the trip metadata holds a
 * row per published trip, which is tens of thousands, and this returns a couple
 * of thousand pairs.
 * @returns One row per route and shape, with its trip count.
 */
async function tripsPerRouteShape(): Promise<RouteShapeTrips[]> {
  const res = await aggregateRows<RouteShapeTrips>("tripMeta", [
    { $match: { shapeId: { $type: "string" }, routeId: { $type: "string" } } },
    { $group: { _id: { routeId: "$routeId", shapeId: "$shapeId" }, trips: { $sum: 1 } } },
  ]);
  return res;
}

/**
 * The route ids among `ids` with at least one arrival on record. A route with
 * none (MEX, EVNT) has nothing behind any page it links to, so the map draws no
 * line for it, as it draws none of its vehicles. Grouping on `routeId` alone
 * after a match on it lets the server walk the `(routeId, scheduledAt)` index
 * with a distinct scan: about one key per route, and no documents.
 * @param ids - Route ids.
 * @returns The ids with history.
 */
async function routesWithHistory(ids: string[]): Promise<Set<string>> {
  const res = await aggregateRows<{ _id: string }>(
    "ArrivalEvent",
    [{ $match: { routeId: { $in: ids } } }, { $group: { _id: "$routeId" } }],
    10_000,
  );
  return new Set(res.map((r) => r._id));
}

/**
 * Every route's road paths, thinned for a whole-network overlay and tagged with
 * its mode and its line colour. Cached for a day: shapes and trip metadata
 * only change when the GTFS sync runs.
 *
 * Feed-version republishes are folded to one line per slug - both versions of a
 * republished route drive the same road - and a slug's shapes become its paths
 * through {@link routePaths}. School routes draw no line: AT's GTFS zip carries
 * no shapes for them, and the API has no shape endpoint. Nor does a route with no
 * arrival on record ({@link routesWithHistory}); its line appears with the
 * day's rebuild after its first run.
 * @returns One {@link NetworkLine} per route, buses first so rail and ferry draw on top.
 */
export async function getNetworkLines(): Promise<NetworkLine[]> {
  return unstable_cache(
    async () => {
      const [pairs, routes, shapes] = await Promise.all([
        tripsPerRouteShape(),
        // Current routes only: a retired line still has trip rows, and would draw
        // over its successor on the same rails.
        getDirectoryRoutes(),
        // The whole collection, as the off-route step reads it: about a thousand
        // documents, against several hundred ids in a filter.
        prisma.shape.findMany({ select: { id: true, points: true } }),
      ]);
      const routeById = new Map(routes.map((r) => [r.routeId, r]));
      const pointsById = new Map(shapes.map((s) => [s.id, s.points]));
      // By slug: a new feed version with no arrivals yet still has its route's history.
      const recorded = new Set(
        [...(await routesWithHistory(routes.map((r) => r.routeId)))].map(routeSlug),
      );

      // Gather every stored shape per slug, only where the route's mode is known:
      // a line the mode filter cannot place is a line the map cannot hide. The
      // name and colour come from the version carrying the busiest shape.
      const bySlug = new Map<string, HeldLine>();
      for (const { _id, trips } of pairs) {
        const route = routeById.get(_id.routeId);
        if (route === undefined || !pointsById.has(_id.shapeId)) continue;
        const slug = routeSlug(_id.routeId);
        if (!recorded.has(slug)) continue;
        let held = bySlug.get(slug);
        if (held === undefined || trips > held.top) {
          // Many long names are only the code again ("125"), which the popup already shows.
          const name = lineName(route.mode, route.shortName) ?? route.longName;
          held = {
            shapes: held?.shapes ?? [],
            top: trips,
            name: name && name !== slug ? name : null,
            mode: route.mode,
            colour: routeColour(route.mode, route.colour),
          };
          bySlug.set(slug, held);
        }
        // Two feed versions can publish one shape; their trips add up.
        const same = held.shapes.find((s) => s.shapeId === _id.shapeId);
        if (same) same.trips += trips;
        else held.shapes.push({ shapeId: _id.shapeId, trips });
      }

      /**
       * A shape's points as `[lat, lon]`, or none when malformed. Shapes are
       * stored `[lon, lat]` (GeoJSON order), and `points` is a Json column, so
       * its shape is checked rather than trusted: one malformed document would
       * otherwise cost the whole underlay.
       * @param s - The held shape.
       * @returns The route shape, with no points when malformed.
       */
      const toRouteShape = (s: HeldShape): RouteShape => {
        const stored = pointsById.get(s.shapeId) as unknown as [number, number][] | null;
        const points = Array.isArray(stored)
          ? stored.map(([lon, lat]): [number, number] => [lat, lon])
          : [];
        return { points, trips: s.trips };
      };

      // Rail and ferry first, then by slug: the first route along a road decides
      // which side of it is left, so a fixed order keeps the lanes from swapping
      // sides between one day's build and the next.
      const held = [...bySlug]
        .map(([slug, h]) => ({ slug, ...h, paths: routePaths(h.shapes.map(toRouteShape)) }))
        .filter((h) => h.paths.length > 0)
        .sort((a, b) => MODE_ORDER[b.mode] - MODE_ORDER[a.mode] || a.slug.localeCompare(b.slug));

      // Lanes are found on the full-detail paths and each stretch thinned after,
      // since two routes on one road can thin to paths a street's width apart.
      // Each path goes in on its own, and its runs come back to its route.
      const inputs = held.flatMap((h) =>
        h.paths.map((points) => ({ colour: h.colour, mode: h.mode, points })),
      );
      const lanes = laneRuns(inputs, OVERVIEW_TOLERANCE_M);
      let next = 0;
      const lines: NetworkLine[] = held.map((h) => {
        const runs = lanes.slice(next, next + h.paths.length).flat();
        next += h.paths.length;
        return {
          slug: h.slug,
          name: h.name,
          mode: h.mode,
          colour: h.colour,
          runs: runs.map((run) => ({
            slot: run.slot,
            path: run.points.flatMap(([lat, lon]) => [
              Math.round(lat * WIRE_SCALE) / WIRE_SCALE,
              Math.round(lon * WIRE_SCALE) / WIRE_SCALE,
            ]),
          })),
        };
      });
      return lines
        .filter((l) => l.runs.length > 0)
        .sort((a, b) => MODE_ORDER[a.mode] - MODE_ORDER[b.mode]);
    },
    ["network-lines-v11"],
    { revalidate: 86_400 },
  )();
}
