// src/app/api/routes/top/route.ts
// GET handler returning the top routes leaderboard JSON for an ISO week, ranked by on-time rate or average delay.

import { getTopRoutes } from "@/lib/data";
import { queryIssues, topRoutesQuery } from "@/lib/validate";
import { NextResponse } from "next/server";

/**
 * Get the top routes for an ISO week, ranked by on-time rate or average delay.
 * Thin wrapper over {@link getTopRoutes}; the page calls that helper directly.
 * @param req - Incoming request; query params are validated by `topRoutesQuery`.
 * @returns JSON array of ranked route stats, 400 on invalid query, 500 on failure.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const sp = new URL(req.url).searchParams;
  const parsed = topRoutesQuery.safeParse(Object.fromEntries(sp));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", issues: queryIssues(parsed.error.issues) },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await getTopRoutes(parsed.data));
  } catch (err) {
    console.error("[API] GET /api/routes/top failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
