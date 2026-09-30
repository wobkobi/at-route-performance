// src/app/api/live/route.ts
// GET handler returning every vehicle on a run now, trimmed for the network map.

import { getRecordedLiveTrips } from "@/lib/data/live-stored";
import { getOperatorDirectory } from "@/lib/data/operators";
import { getRouteModeMap } from "@/lib/data/routes";
import { getLiveVehicles } from "@/lib/feed/vehicles";
import { mapVehicles } from "@/lib/live-routes";
import { NextResponse } from "next/server";

/**
 * Every vehicle on a run now, with its route slug, mode, operator and delay. Public read;
 * the live page's map polls this every two minutes. Backed by the same 120s
 * feed cache as the route maps, so viewers share one upstream call.
 * @returns JSON `{ vehicles, operators }` (`operators` the stored entries for the
 *   codes the vehicles carry, which name them), or 502 with an empty list on upstream failure.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const [all, modes, [operators, directory], stored] = await Promise.all([
      getLiveVehicles(),
      getRouteModeMap(),
      // The popup's operator line is a nicety; the dots draw without it.
      getOperatorDirectory(),
      // So is the recorded-trip flag: without it every trip counts as recorded and none is hidden.
      getRecordedLiveTrips().catch(() => null),
    ]);
    const vehicles = mapVehicles(all, modes, operators, stored);
    const codes = new Set(vehicles.map((v) => v.op));
    return NextResponse.json({ vehicles, operators: directory.filter((o) => codes.has(o.code)) });
  } catch (err) {
    console.error("[API] GET /api/live failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "server_error", vehicles: [] }, { status: 502 });
  }
}
