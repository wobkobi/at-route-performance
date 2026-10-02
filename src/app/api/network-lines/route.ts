// src/app/api/network-lines/route.ts
// GET handler returning the road path of every route, for the live map's underlay.

import { readFailed } from "@/lib/api-error";
import { getNetworkLines } from "@/lib/data";
import { NextResponse } from "next/server";

/**
 * Every route's road path, thinned for a network overlay. Public read, fetched
 * once per reader by the live map and then held for the session, so it is cached
 * hard: the geometry only changes when the GTFS shapes sync runs, and a reader
 * meeting a day-old road layout under live dots has lost nothing.
 * @returns JSON `{ lines }`; on failure 503/500 with an empty list, since the
 *   lines are the map's background and the live dots draw without them.
 */
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(
      { lines: await getNetworkLines() },
      {
        headers: {
          "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
        },
      },
    );
  } catch (err) {
    return readFailed("api-network-lines", err, { extra: { lines: [] } });
  }
}
