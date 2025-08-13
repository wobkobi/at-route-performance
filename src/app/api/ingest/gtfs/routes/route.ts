// src/app/api/ingest/gtfs/routes/route.ts
import { fetchRoutes, mapRouteType, type RouteAttr } from "@/lib/at-static";
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * Ingest GTFS routes from AT v3 into the Route table.
 * Uses upsert-like behavior via createMany + skipDuplicates.
 * @returns JSON `{ inserted: number }`.
 */
export async function POST(): Promise<NextResponse> {
  const routes: RouteAttr[] = await fetchRoutes();

  const rows = routes
    .filter((r) => r.route_id && r.route_long_name)
    .map((r) => ({
      id: r.route_id,
      shortName: r.route_short_name ?? null,
      longName: r.route_long_name,
      mode: mapRouteType(r.route_type),
    }));

  if (rows.length) {
    await prisma.route.createMany({ data: rows, skipDuplicates: true });
  }
  return NextResponse.json({ inserted: rows.length });
}
