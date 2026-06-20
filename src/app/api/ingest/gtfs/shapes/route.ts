// src/app/api/ingest/gtfs/shapes/route.ts
import { requireCronAuth } from "@/lib/auth";
import { syncShapes } from "@/lib/ingest";
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
    console.log("[SHAPES] Starting GTFS shapes sync", { timestamp: new Date().toISOString() });
    const shapes = await syncShapes();
    const duration = Date.now() - startTime;
    console.log("[SHAPES] Complete", { shapes: shapes.upserted, duration_ms: duration });
    return NextResponse.json({
      shapes,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[SHAPES] Failed", { error: msg, duration_ms: Date.now() - startTime });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
