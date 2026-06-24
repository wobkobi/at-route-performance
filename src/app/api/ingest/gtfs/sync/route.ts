// src/app/api/ingest/gtfs/sync/route.ts
import { fetchCurrentGtfsVersion } from "@/lib/at-versions";
import { requireCronAuth } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/gtfs-setting";
import { syncRoutes, syncStops } from "@/lib/ingest";
import { recordIngestRun } from "@/lib/ingest-run";
import { NextResponse } from "next/server";

// Static GTFS sync touches thousands of rows; give it headroom over the default.
export const maxDuration = 60;

/**
 * Orchestrator: sync GTFS static data (routes + stops) in-process.
 * Scheduled daily by the external scheduler (see docs/cron-setup.md).
 * @param req - Incoming request; requires the CRON_SECRET bearer token.
 * @returns JSON `{ routes, stops, total_duration_ms, timestamp }`.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const startTime = Date.now();

  const denied = requireCronAuth(req);
  if (denied) return denied;

  // ?force=1 bypasses the version gate for manual re-syncs.
  const force = new URL(req.url).searchParams.get("force") === "1";

  try {
    const version = await fetchCurrentGtfsVersion();
    if (version && !force) {
      const lastVersion = await getSetting("gtfs_version");
      if (lastVersion === version) {
        console.log("[SYNC] Skipping — version unchanged:", version);
        await recordIngestRun({
          endpoint: "gtfs/sync",
          startedAt: new Date(startTime),
          success: true,
          count: 0,
        });
        return NextResponse.json({ skipped: true, version });
      }
    }

    console.log("[SYNC] Starting static GTFS sync", {
      timestamp: new Date().toISOString(),
    });

    const routesStart = Date.now();
    const routes = await syncRoutes();
    const routesDuration = Date.now() - routesStart;

    const stopsStart = Date.now();
    const stops = await syncStops();
    const stopsDuration = Date.now() - stopsStart;

    if (version) await setSetting("gtfs_version", version);

    const totalDuration = Date.now() - startTime;
    const result = {
      routes: { ...routes, duration_ms: routesDuration },
      stops: { ...stops, duration_ms: stopsDuration },
      total_duration_ms: totalDuration,
      timestamp: new Date().toISOString(),
      version,
    };

    console.log("[SYNC] Complete", {
      total_duration_ms: totalDuration,
      routes: routes.upserted,
      stops: stops.upserted,
    });

    await recordIngestRun({
      endpoint: "gtfs/sync",
      startedAt: new Date(startTime),
      success: true,
      count: routes.upserted + stops.upserted,
    });

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[SYNC] Failed", {
      error: msg,
      duration_ms: Date.now() - startTime,
    });
    await recordIngestRun({
      endpoint: "gtfs/sync",
      startedAt: new Date(startTime),
      success: false,
      error: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
