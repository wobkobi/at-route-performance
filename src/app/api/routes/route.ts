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
    // The route directory only changes on the daily GTFS sync.
    headers: { "Cache-Control": "public, max-age=0, s-maxage=3600" },
  });
}
