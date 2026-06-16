// src/app/api/routes/[id]/stats/route.ts
import { getRouteStats } from "@/lib/data";
import { routeStatsQuery } from "@/lib/validate";
import { NextResponse } from "next/server";

/**
 * Summarise a route's performance over a window (defaults to the last 7 days).
 * Thin wrapper over {@link getRouteStats}; the page calls that helper directly.
 * @param req - Request; query params validated by `routeStatsQuery`.
 * @param ctx - Route context holding the dynamic params.
 * @param ctx.params - Promise resolving to `{ id }` (the route id).
 * @returns JSON `{ route, summary, byStop }`, 400 on invalid query, 500 on failure.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const parsed = routeStatsQuery.safeParse(Object.fromEntries(sp));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const stats = await getRouteStats({
      routeId: id,
      from: parsed.data.from,
      to: parsed.data.to,
      thresholdSec: parsed.data.thresholdSec,
    });
    return NextResponse.json(stats);
  } catch (err) {
    console.error("GET /api/routes/[id]/stats failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
