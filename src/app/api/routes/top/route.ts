// src/app/api/routes/top/route.ts
import { getTopRoutes } from "@/lib/data";
import { topRoutesQuery } from "@/lib/validate";
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
      { error: "invalid_query", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await getTopRoutes(parsed.data));
  } catch (err) {
    console.error("GET /api/routes/top failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
