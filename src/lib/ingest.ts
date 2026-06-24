// src/lib/ingest.ts
import { fetchRoutes, fetchStops, mapRouteType } from "@/lib/at-static";
import { prisma } from "@/lib/db";
import { fetchShapes } from "@/lib/gtfs-shapes";
import { fetchTrips } from "@/lib/gtfs-trips";

/** Max update operations per bulk `update` command (well under Mongo's 1000 cap). */
const BATCH = 500;

/** A single bulk upsert operation: match by `_id`, set fields, insert if absent. */
interface UpsertOp {
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
 * Fetch GTFS routes from AT and upsert them into the Route collection.
 * @returns Count of routes upserted.
 */
export async function syncRoutes(): Promise<{ upserted: number }> {
  const routes = await fetchRoutes();
  const ops: UpsertOp[] = routes
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
        },
      },
    }));

  await bulkUpsert("Route", ops);
  return { upserted: ops.length };
}

/**
 * Fetch GTFS stops from AT and upsert them into the Stop collection.
 * @param date - Optional service date (YYYY-MM-DD); defaults to the AT default.
 * @returns Count of stops upserted.
 */
export async function syncStops(date?: string): Promise<{ upserted: number }> {
  const stops = await fetchStops(date);
  const ops: UpsertOp[] = stops
    .filter(
      (s) => s.stop_id && s.stop_name && Number.isFinite(s.stop_lat) && Number.isFinite(s.stop_lon),
    )
    .map((s) => ({
      q: { _id: s.stop_id },
      u: {
        $set: {
          name: s.stop_name,
          code: s.stop_code ?? null,
          lat: s.stop_lat,
          lon: s.stop_lon,
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
 * `tripMeta` collection (headsign + direction keyed by trip_id).
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
      },
    },
  }));

  await bulkUpsert("tripMeta", ops);
  return { upserted: ops.length };
}
