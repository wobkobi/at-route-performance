// src/lib/ingest.ts
// Bulk-upsert routes, stops, shapes and trips from the AT static and GTFS feeds.
// Writes go through the raw Mongo `update` command in batches rather than
// per-document `prisma.upsert`: far fewer round-trips, and each update is atomic
// on its own, so it sidesteps the multi-document transactions a replica set would
// otherwise demand. Batches stay well under Mongo's 1000-op cap and run unordered
// so one bad row does not abort the rest.
import { fetchRoutes, fetchStops, mapRouteType, type RouteAttr } from "@/lib/at-static";
import { prisma } from "@/lib/db";
import { fetchShapes } from "@/lib/gtfs-shapes";
import { fetchTrips } from "@/lib/gtfs-trips";

/** Max update operations per bulk `update` command (well under Mongo's 1000 cap). */
const BATCH = 500;

/** A single bulk upsert operation: match by `_id`, set fields, insert if absent. */
export interface UpsertOp {
  q: { _id: string };
  u: { $set: Record<string, unknown> };
}

/**
 * Apply upserts to a collection in bulk via the Mongo `update` command.
 * Far fewer round-trips than per-document `prisma.upsert`, and each update is
 * atomic on its own, so it avoids the multi-document transactions that a
 * replica set would otherwise require.
 * @param collection - Target collection name.
 * @param ops - Upsert operations keyed by `_id`.
 */
async function bulkUpsert(collection: string, ops: UpsertOp[]): Promise<void> {
  for (let i = 0; i < ops.length; i += BATCH) {
    const updates = ops.slice(i, i + BATCH).map((o) => ({ ...o, upsert: true, multi: false }));
    await prisma.$runCommandRaw({
      update: collection,
      updates: updates as never,
      ordered: false,
    });
  }
}

/**
 * Build the Route upsert ops for one sync run, every row stamped with `seenAt`.
 *
 * The stamp goes through extended JSON (`{ $date }`) rather than a `Date`:
 * `$runCommandRaw` JSON-serialises its arguments, so a bare `Date` lands in the
 * collection as an ISO string, which Prisma then refuses to read as `DateTime`
 * (P2023) and which no date comparison ever matches.
 * @param routes - Routes as AT publishes them.
 * @param seenAt - The instant this sync ran.
 * @returns One upsert op per publishable route (id and long name present).
 */
export function routeUpsertOps(routes: RouteAttr[], seenAt: Date): UpsertOp[] {
  return routes
    .filter((r) => r.route_id && r.route_long_name)
    .map((r) => ({
      q: { _id: r.route_id },
      u: {
        $set: {
          shortName: r.route_short_name ?? null,
          longName: r.route_long_name,
          mode: mapRouteType(r.route_type),
          colour: r.route_color ? r.route_color.replace(/^#/, "") : null,
          textColour: r.route_text_color ? r.route_text_color.replace(/^#/, "") : null,
          lastSeenAt: { $date: seenAt.toISOString() },
        },
      },
    }));
}

/**
 * Fetch GTFS routes from AT and upsert them into the Route collection.
 *
 * Every route in this run is stamped with `lastSeenAt`. Routes are never
 * deleted - a retired one still holds years of retained summaries, and its URL
 * has to keep resolving so it can redirect to whatever replaced it - so the
 * stamp is what lets a directory list only the routes that currently run. The
 * City Rail Link retires four train lines at once on 13 September 2026.
 * @returns Count of routes upserted.
 */
export async function syncRoutes(): Promise<{ upserted: number }> {
  const ops = routeUpsertOps(await fetchRoutes(), new Date());
  await bulkUpsert("Route", ops);
  return { upserted: ops.length };
}

/**
 * Fetch GTFS stops from AT and upsert them into the Stop collection.
 *
 * AT's feed carries ~140 `location_type: 1` parent stations alongside the real
 * stops. Nothing ever departs from one, so they can never gain an arrival event,
 * and each shares its name with the platforms beneath it - stored, they would
 * show up in the stop directory as a phantom duplicate of every station. Only
 * boardable stops are kept.
 *
 * `parent_station` and `platform_code` are AT's own grouping of platforms and
 * poles into a station; storing them lets station collapsing key off the feed
 * rather than off stop names, which AT renames (Britomart > Waitemata, Mount
 * Eden > Maungawhau).
 * @param date - Optional service date (YYYY-MM-DD); defaults to the AT default.
 * @returns Count of stops upserted.
 */
export async function syncStops(date?: string): Promise<{ upserted: number }> {
  const stops = await fetchStops(date);
  const ops: UpsertOp[] = stops
    .filter(
      (s) =>
        s.stop_id &&
        s.stop_name &&
        Number.isFinite(s.stop_lat) &&
        Number.isFinite(s.stop_lon) &&
        (s.location_type ?? 0) === 0,
    )
    .map((s) => ({
      q: { _id: s.stop_id },
      u: {
        $set: {
          name: s.stop_name,
          code: s.stop_code ?? null,
          lat: s.stop_lat,
          lon: s.stop_lon,
          parentStation: s.parent_station ?? null,
          platformCode: s.platform_code ?? null,
        },
      },
    }));

  await bulkUpsert("Stop", ops);
  return { upserted: ops.length };
}

/**
 * Fetch GTFS shape geometry from AT's full feed and upsert it into the Shape
 * collection (simplified `[lon, lat]` paths keyed by shape_id).
 * @returns Count of shapes upserted.
 */
export async function syncShapes(): Promise<{ upserted: number }> {
  const shapes = await fetchShapes();
  const ops: UpsertOp[] = shapes.map((s) => ({
    q: { _id: s.id },
    u: { $set: { points: s.points } },
  }));

  await bulkUpsert("Shape", ops);
  return { upserted: ops.length };
}

/**
 * Fetch GTFS trip metadata from AT's full feed and upsert it into the
 * `tripMeta` collection (headsign, direction and shape keyed by trip_id).
 * @returns Count of trips upserted.
 */
export async function syncTripMeta(): Promise<{ upserted: number }> {
  const trips = await fetchTrips();
  const ops: UpsertOp[] = trips.map((t) => ({
    q: { _id: t.id },
    u: {
      $set: {
        routeId: t.routeId,
        headsign: t.headsign,
        directionId: t.directionId,
        shapeId: t.shapeId,
      },
    },
  }));

  await bulkUpsert("tripMeta", ops);
  return { upserted: ops.length };
}
