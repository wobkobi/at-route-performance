// src/app/api/stops/route.ts
// Read-only stop directory. Stops are written by the GTFS ingest routes only.
import { apiError, readFailed } from "@/lib/api-error";
import { listStops } from "@/lib/data";
import { queryIssues, stopsQuery } from "@/lib/validate";
import { NextResponse } from "next/server";

/**
 * List stops ordered by name, paginated.
 *
 * Paginated rather than dumping the collection: this is a public endpoint on a
 * self-hosted database, and an unbounded full-table read is both the slowest
 * query on the site and the cheapest way to hammer it.
 * @param request - Incoming request; `?limit` (default 200, max 1000) and `?offset`.
 * @returns JSON `{ stops, limit, offset, total }`; 400 on an invalid query, 503/500 on failure.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const sp = new URL(request.url).searchParams;
  const parsed = stopsQuery.safeParse(Object.fromEntries(sp));
  if (!parsed.success) {
    return apiError(400, "invalid_query", "The query did not validate.", {
      issues: queryIssues(parsed.error.issues),
    });
  }
  const { limit, offset } = parsed.data;
  try {
    const { stops, total } = await listStops(limit, offset);
    return NextResponse.json(
      { stops, limit, offset, total },
      // The stop directory only changes on the daily GTFS sync.
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=3600" } },
    );
  } catch (err) {
    return readFailed("api-stops", err);
  }
}
