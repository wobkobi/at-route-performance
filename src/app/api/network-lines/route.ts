// src/app/api/network-lines/route.ts
// GET handler returning the road path of every route, for the live map's underlay.

import { getNetworkLines } from "@/lib/data/network-lines";
import { NextResponse } from "next/server";

/**
 * Every route's road path, thinned for a network overlay. Public read, fetched
 * once per reader by the live map and then held for the session, so it is cached
 * hard: the geometry only changes when the GTFS shapes sync runs, and a reader
 * meeting a day-old road layout under live dots has lost nothing.
 * @returns JSON `{ lines }`, or 502 with an empty list when the read fails.
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
    console.error("[API] GET /api/network-lines failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    // The lines are the map's background, so a failure costs the underlay and
    // not the page: the live dots draw without it.
    return NextResponse.json({ error: "server_error", lines: [] }, { status: 502 });
  }
}
