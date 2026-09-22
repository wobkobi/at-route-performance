// src/app/api/live/route.ts
// GET handler returning every vehicle on a run now, trimmed for the network map.

import { getRouteModeMap } from "@/lib/data/routes";
import { mapVehicles } from "@/lib/live-routes";
import { getLiveVehicles } from "@/lib/vehicles";
import { NextResponse } from "next/server";

/**
 * Every vehicle on a run now, with its route slug, mode and delay. Public read;
 * the live page's map polls this every two minutes. Backed by the same 120s
 * feed cache as the route maps, so viewers share one upstream call.
 * @returns JSON `{ vehicles }`, or 502 with an empty list on upstream failure.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const [all, modes] = await Promise.all([getLiveVehicles(), getRouteModeMap()]);
    return NextResponse.json({ vehicles: mapVehicles(all, modes) });
  } catch (err) {
    console.error("[API] GET /api/live failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "server_error", vehicles: [] }, { status: 502 });
  }
}
