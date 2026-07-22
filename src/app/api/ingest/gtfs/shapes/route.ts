// src/app/api/ingest/gtfs/shapes/route.ts
/**
 * @description Cron-only POST that syncs GTFS shape geometry (road paths) and
 * trip metadata. Both run in parallel off AT's full GTFS zip, which is large to
 * download and parse - hence the extended maxDuration and the infrequent, static
 * schedule rather than the regular ingest cadence. Responds 202 before the sync
 * runs (it takes minutes, far past the external scheduler's 30s request
 * timeout); the outcome is recorded in IngestRun and the function logs.
 */
import { requireCronAuth } from "@/lib/auth";
import { syncShapes, syncTripMeta } from "@/lib/ingest";
import { recordIngestRun } from "@/lib/ingest-run";
import { after, NextResponse } from "next/server";

// Downloads + parses AT's full GTFS zip (large); give it generous headroom.
// 300s needs fluid compute on the Hobby plan (classic serverless caps at 60s);
// verify it is enabled under Project > Settings > Functions before relying on it.
export const maxDuration = 300;

/**
 * Run the shapes + trip-meta sync and record the outcome. Invoked via `after`
 * so the 202 response is sent first.
 * @param startTime - Epoch ms when the request arrived.
 */
async function runShapesSync(startTime: number): Promise<void> {
  try {
    console.log("[SHAPES] Starting GTFS shapes + trip meta sync", {
      timestamp: new Date().toISOString(),
    });
    const [shapes, tripMeta] = await Promise.all([syncShapes(), syncTripMeta()]);
    console.log("[SHAPES] Complete", {
      shapes: shapes.upserted,
      tripMeta: tripMeta.upserted,
      duration_ms: Date.now() - startTime,
    });
    await recordIngestRun({
      endpoint: "gtfs/shapes",
      startedAt: new Date(startTime),
      success: true,
      count: shapes.upserted + tripMeta.upserted,
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
  }
}

/**
 * Sync GTFS shape geometry (road paths) into the Shape collection. Scheduled
 * (less often than the other ingests; the schedule is static) by the external
 * scheduler - see docs/cron-setup.md. Acknowledges, then syncs after the response.
 * @param req - Incoming request; requires the CRON_SECRET bearer token.
 * @returns 202 JSON `{ started }`; 401/500 on auth/config failure.
 */
export function POST(req: Request): NextResponse {
  const startTime = Date.now();

  const denied = requireCronAuth(req);
  if (denied) return denied;

  after(() => runShapesSync(startTime));

  return NextResponse.json({ started: true }, { status: 202 });
}
