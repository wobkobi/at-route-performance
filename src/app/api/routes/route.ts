// src/app/api/routes/route.ts
// Read-only route directory. Routes are written by the GTFS ingest routes only.
import { getDirectoryRoutes } from "@/lib/data";
import { NextResponse } from "next/server";

/**
 * List the routes AT's most recent GTFS sync published, ordered by short name.
 *
 * Retired routes are excluded: their rows persist for history and redirects, so
 * listing every row would advertise lines that no longer run - four train lines
 * retire at once at the CRL cutover.
 * @returns JSON array of current routes.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(await getDirectoryRoutes(), {
    // The rows change on the daily GTFS sync, but the lineage trim inside
    // `getDirectoryRoutes` turns on `routeHasTraffic`, which holds for 600s and
    // flips within ten minutes of a successor's first train. This must not
    // outlast that: a longer s-maxage puts the staleness the data layer was
    // careful to avoid straight back in front of the reader, and at the CRL
    // cutover that means listing a retired line beside the one replacing it.
    headers: { "Cache-Control": "public, max-age=0, s-maxage=600" },
  });
}
