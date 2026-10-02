// src/app/api/routes/[id]/vehicles/route.ts
// GET handler returning live vehicle positions JSON for a route, each with its current delay.

import { readFailed } from "@/lib/api-error";
import { getOperatorDirectory } from "@/lib/data";
import { getLiveVehicles } from "@/lib/feed/vehicles";
import { operatorOf } from "@/lib/operators";
import { routeSlug } from "@/lib/route/slug";
import { NextResponse } from "next/server";

/**
 * Live vehicle positions for a route, each with its current delay.
 * Public read; the route detail map polls this every two minutes. Backed by a
 * 120s cache so the upstream AT feed is hit at most once per window regardless
 * of viewers.
 * @param _request - Incoming request (unused).
 * @param ctx - Route context.
 * @param ctx.params - Promise resolving to the dynamic `{ id }` route param.
 * @returns JSON `{ vehicles, operator }` (`operator` the route's operator, or
 *   null); on failure an empty list with 503 for the database, else 502 for AT's feed.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const [all, [operators, directory]] = await Promise.all([
      getLiveVehicles(),
      getOperatorDirectory(),
    ]);
    // AT's real-time feed includes versioned route ids (e.g. "NX1-202409"); strip
    // the version suffix before comparing so they match the URL slug "NX1".
    return NextResponse.json(
      {
        vehicles: all.filter((v) => routeSlug(v.routeId) === id),
        operator: operatorOf(operators[id], directory),
      },
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=60" } },
    );
  } catch (err) {
    return readFailed("api-route-vehicles", err, { extra: { vehicles: [] }, upstream: true });
  }
}
