// src/lib/ingest.ts
import { fetchRoutes, fetchStops, mapRouteType } from "@/lib/at-static";
import { prisma } from "@/lib/db";

/** Number of upserts issued concurrently per batch. */
const CHUNK = 50;

/**
 * Run an async operation over items in concurrent chunks (bounded fan-out).
 * @param items - Items to process.
 * @param fn - Operation applied to each item.
 */
async function inChunks<T>(items: T[], fn: (item: T) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += CHUNK) {
    await Promise.all(items.slice(i, i + CHUNK).map(fn));
  }
}

/**
 * Fetch GTFS routes from AT and upsert them into the Route collection.
 * @returns Count of routes upserted.
 */
export async function syncRoutes(): Promise<{ upserted: number }> {
  const routes = await fetchRoutes();
  const rows = routes
    .filter((r) => r.route_id && r.route_long_name)
    .map((r) => ({
      id: r.route_id,
      shortName: r.route_short_name ?? null,
      longName: r.route_long_name,
      mode: mapRouteType(r.route_type),
    }));

  await inChunks(rows, (row) =>
    prisma.route.upsert({
      where: { id: row.id },
      create: row,
      update: {
        shortName: row.shortName,
        longName: row.longName,
        mode: row.mode,
      },
    }),
  );
  return { upserted: rows.length };
}

/**
 * Fetch GTFS stops from AT and upsert them into the Stop collection.
 * @param date - Optional service date (YYYY-MM-DD); defaults to the AT default.
 * @returns Count of stops upserted.
 */
export async function syncStops(date?: string): Promise<{ upserted: number }> {
  const stops = await fetchStops(date);
  const rows = stops
    .filter(
      (s) => s.stop_id && s.stop_name && Number.isFinite(s.stop_lat) && Number.isFinite(s.stop_lon),
    )
    .map((s) => ({
      id: s.stop_id,
      name: s.stop_name,
      code: s.stop_code ?? null,
      lat: s.stop_lat,
      lon: s.stop_lon,
    }));

  await inChunks(rows, (row) =>
    prisma.stop.upsert({
      where: { id: row.id },
      create: row,
      update: { name: row.name, code: row.code, lat: row.lat, lon: row.lon },
    }),
  );
  return { upserted: rows.length };
}
