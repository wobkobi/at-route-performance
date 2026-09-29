// src/app/api/routes/[id]/vehicles/route.ts
// GET handler returning live vehicle positions JSON for a route, each with its current delay.

import { getRouteOperators } from "@/lib/data/routes";
import { readFallback } from "@/lib/db";
import { routeSlug } from "@/lib/route-slug";
import { getLiveVehicles } from "@/lib/vehicles";
import { NextResponse } from "next/server";

/**
 * Live vehicle positions for a route, each with its current delay.
 * Public read; the route detail map polls this every two minutes. Backed by a
 * 120s cache so the upstream AT feed is hit at most once per window regardless
 * of viewers.
 * @param _req - Incoming request (unused).
 * @param ctx - Route context.
 * @param ctx.params - Promise resolving to the dynamic `{ id }` route param.
 * @returns JSON `{ vehicles, op }` (`op` the route's operator code, or null), or
 *   502 with an empty list on upstream failure.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const [all, operators] = await Promise.all([
      getLiveVehicles(),
      getRouteOperators().catch(readFallback<Record<string, string>>("route-operators", {})),
    ]);
    // AT's real-time feed includes versioned route ids (e.g. "NX1-202409"); strip
    // the version suffix before comparing so they match the URL slug "NX1".
    return NextResponse.json({
      vehicles: all.filter((v) => routeSlug(v.routeId) === id),
      op: operators[id] ?? null,
    });
  } catch (err) {
    console.error("[API] GET /api/routes/[id]/vehicles failed", {
      routeId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "server_error", vehicles: [] }, { status: 502 });
  }
}
