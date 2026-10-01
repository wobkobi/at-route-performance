// src/app/api/routes/[id]/stats/route.ts
// GET handler returning a route's performance summary JSON over a window (defaults to the last 7 days).

import { apiError, readFailed } from "@/lib/api-error";
import { getRouteStats } from "@/lib/data";
import { queryIssues, routeStatsQuery, type RouteStatsQuery } from "@/lib/validate";
import type { RouteByStop } from "@/types/api";
import { NextResponse } from "next/server";

/** The by-stop field each `?sort` orders on, largest first. */
const SORT_FIELD: Record<RouteStatsQuery["sort"], keyof RouteByStop> = {
  events: "events",
  avg_delay: "avg_delay_sec",
  on_time_rate: "on_time_pct",
};

/**
 * Summarise a route's performance over a window (defaults to the last 7 days).
 * Thin wrapper over {@link getRouteStats}, which returns its stops busiest
 * first; `?sort` reorders them here.
 * @param request - Request; query params validated by `routeStatsQuery`.
 * @param ctx - Route context holding the dynamic params.
 * @param ctx.params - Promise resolving to `{ id }` (the route id).
 * @returns JSON `{ route, summary, byStop }`; 400 on an invalid query, 503/500 on failure.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const sp = new URL(request.url).searchParams;
  const parsed = routeStatsQuery.safeParse(Object.fromEntries(sp));
  if (!parsed.success) {
    return apiError(400, "invalid_query", "The query did not validate.", {
      issues: queryIssues(parsed.error.issues),
    });
  }
  const { range, sort } = parsed.data;
  try {
    const stats = await getRouteStats({ routeId: id, from: range?.start, to: range?.end });
    const field = SORT_FIELD[sort];
    // Nulls last: a stop with no reading has nothing to rank on.
    const byStop = stats.byStop.toSorted(
      (a, b) => Number(b[field] ?? -Infinity) - Number(a[field] ?? -Infinity),
    );
    return NextResponse.json(
      { ...stats, byStop },
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=300" } },
    );
  } catch (err) {
    return readFailed("api-route-stats", err);
  }
}
