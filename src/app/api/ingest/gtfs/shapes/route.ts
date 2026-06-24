// src/app/api/ingest/gtfs/shapes/route.ts
import { requireCronAuth } from "@/lib/auth";
import { syncShapes, syncTripMeta } from "@/lib/ingest";
import { recordIngestRun } from "@/lib/ingest-run";
import { NextResponse } from "next/server";

// Downloads + parses AT's full GTFS zip (large); give it generous headroom.
export const maxDuration = 300;

/**
 * Sync GTFS shape geometry (road paths) into the Shape collection. Scheduled
 * (less often than the other ingests; the schedule is static) by the external
 * scheduler - see docs/cron-setup.md.
 * @param req - Incoming request; requires the CRON_SECRET bearer token.
 * @returns JSON `{ shapes, duration_ms, timestamp }`.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const startTime = Date.now();

  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    console.log("[SHAPES] Starting GTFS shapes + trip meta sync", {
      timestamp: new Date().toISOString(),
    });
    const [shapes, tripMeta] = await Promise.all([syncShapes(), syncTripMeta()]);
    const duration = Date.now() - startTime;
    console.log("[SHAPES] Complete", {
      shapes: shapes.upserted,
      tripMeta: tripMeta.upserted,
      duration_ms: duration,
    });
    await recordIngestRun({
      endpoint: "gtfs/shapes",
      startedAt: new Date(startTime),
      success: true,
      count: shapes.upserted + tripMeta.upserted,
    });
    return NextResponse.json({
      shapes,
      tripMeta,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[SHAPES] Failed", { error: msg, duration_ms: Date.now() - startTime });
    await recordIngestRun({
      endpoint: "gtfs/shapes",
      startedAt: new Date(startTime),
      success: false,
      error: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
