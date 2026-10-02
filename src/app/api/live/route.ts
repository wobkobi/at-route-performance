// src/app/api/live/route.ts
// GET handler returning every vehicle on a run now, trimmed for the network map.

import { readFailed } from "@/lib/api-error";
import {
  getDirectoryRoutes,
  getOperatorDirectory,
  getRecordedLiveTrips,
  getRouteModeMap,
} from "@/lib/data";
import { readFallback } from "@/lib/db";
import { getLiveVehicles } from "@/lib/feed/vehicles";
import { mapVehicles } from "@/lib/live-routes";
import { routeSlug } from "@/lib/route/slug";
import { isSchoolBus } from "@/lib/school-bus";
import { NextResponse } from "next/server";

/**
 * Every vehicle on a run now, with its route slug, mode, operator and delay. Public read;
 * the live page's map polls this every two minutes. Backed by the same 120s
 * feed cache as the route maps, so viewers share one upstream call.
 * @returns JSON `{ vehicles, operators }` (`operators` the stored entries for the
 *   codes the vehicles carry, which name them); on failure an empty list with
 *   503 for the database, else 502 for AT's feed.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const [all, modes, [operators, directory], stored, routes] = await Promise.all([
      getLiveVehicles(),
      getRouteModeMap(),
      // The popup's operator line is a nicety; the dots draw without it.
      getOperatorDirectory(),
      // So is the recorded-trip flag: without it every trip counts as recorded and none is hidden.
      getRecordedLiveTrips().catch(readFallback("api-live-recorded-trips", null)),
      // And the school glyph: without the names a school bus draws as any other bus.
      getDirectoryRoutes().catch(readFallback("api-live-school-routes", [])),
    ]);
    const school = new Set(
      routes.filter((r) => isSchoolBus(r.shortName, r.longName)).map((r) => routeSlug(r.routeId)),
    );
    const vehicles = mapVehicles(all, modes, { operators, stored, school });
    const codes = new Set(vehicles.map((v) => v.operatorCode));
    return NextResponse.json(
      { vehicles, operators: directory.filter((o) => codes.has(o.code)) },
      // Shorter than the feed's own 120s hold, so the CDN never stretches it.
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=60" } },
    );
  } catch (err) {
    return readFailed("api-live", err, { extra: { vehicles: [] }, upstream: true });
  }
}
