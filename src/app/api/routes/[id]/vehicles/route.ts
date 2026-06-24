// src/app/api/routes/[id]/vehicles/route.ts
import { routeSlug } from "@/lib/route-slug";
import { getLiveVehicles } from "@/lib/vehicles";
import { NextResponse } from "next/server";

/**
 * Live vehicle positions for a route, each with its current delay.
 * Public read; the route detail map polls this. Backed by a 15s cache so the
 * upstream AT feed is hit at most once per window regardless of viewers.
 * @param _req - Incoming request (unused).
 * @param ctx - Route context.
 * @param ctx.params - Promise resolving to the dynamic `{ id }` route param.
 * @returns JSON `{ vehicles }`, or 502 with an empty list on upstream failure.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const all = await getLiveVehicles();
    // AT's real-time feed includes versioned route ids (e.g. "NX1-202409"); strip
    // the version suffix before comparing so they match the URL slug "NX1".
    return NextResponse.json({ vehicles: all.filter((v) => routeSlug(v.routeId) === id) });
  } catch (err) {
    console.error("GET /api/routes/[id]/vehicles failed", err);
    return NextResponse.json({ error: "server_error", vehicles: [] }, { status: 502 });
  }
}
