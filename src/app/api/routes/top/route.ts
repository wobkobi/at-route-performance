// src/app/api/routes/top/route.ts
// GET handler returning the top routes leaderboard JSON for an ISO week, ranked by on-time rate or average delay.

import { apiError, readFailed } from "@/lib/api-error";
import { getTopRoutes } from "@/lib/data";
import { queryIssues, topRoutesQuery } from "@/lib/validate";
import { NextResponse } from "next/server";

/**
 * Get the top routes for an ISO week, ranked by on-time rate or average delay.
 * Thin wrapper over {@link getTopRoutes}, which caches by the week's state.
 * @param request - Incoming request; query params are validated by `topRoutesQuery`.
 * @returns JSON array of ranked route stats; 400 on an invalid query, 503/500 on failure.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const sp = new URL(request.url).searchParams;
  const parsed = topRoutesQuery.safeParse(Object.fromEntries(sp));
  if (!parsed.success) {
    return apiError(400, "invalid_query", "The query did not validate.", {
      issues: queryIssues(parsed.error.issues),
    });
  }
  try {
    return NextResponse.json(await getTopRoutes(parsed.data), {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=600" },
    });
  } catch (err) {
    return readFailed("api-routes-top", err);
  }
}
