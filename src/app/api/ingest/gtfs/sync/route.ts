// src/app/api/ingest/gtfs/sync/route.ts
/**
 * @description Cron-only POST that orchestrates the in-process GTFS static sync
 * of routes then stops. A version gate skips the work when AT's published feed
 * version matches the last stored one, so the daily schedule does no redundant
 * upserts; the new version is only recorded after both syncs succeed, leaving the
 * gate open for a retry if either fails. ?force=1 bypasses the gate for a manual
 * re-sync. When the gate passes, responds 202 before the sync runs (it can
 * exceed the external scheduler's 30s request timeout); the outcome is recorded
 * in IngestRun and the function logs.
 */
import { fetchCurrentGtfsVersion } from "@/lib/at-versions";
import { requireCronAuth } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/gtfs-settings";
import { syncRoutes, syncStops } from "@/lib/ingest";
import { recordIngestRun } from "@/lib/ingest-run";
import { after, NextResponse } from "next/server";

// Static GTFS sync touches thousands of rows; give it headroom over the default.
export const maxDuration = 60;

/**
 * Run the routes + stops sync and record the outcome. Invoked via `after` so
 * the 202 response is sent first.
 * @param startTime - Epoch ms when the request arrived.
 * @param version - AT's published feed version to store on success, or null.
 */
async function runGtfsSync(startTime: number, version: string | null): Promise<void> {
  try {
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

    console.log("[SYNC] Complete", {
      total_duration_ms: Date.now() - startTime,
      routes: { ...routes, duration_ms: routesDuration },
      stops: { ...stops, duration_ms: stopsDuration },
      version,
    });

    await recordIngestRun({
      endpoint: "gtfs/sync",
      startedAt: new Date(startTime),
      success: true,
      count: routes.upserted + stops.upserted,
    });
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
  }
}

/**
 * Orchestrator: sync GTFS static data (routes + stops) in-process.
 * Scheduled daily by the external scheduler (see docs/cron-setup.md). The
 * version gate answers synchronously; a real sync acknowledges with 202 and
 * runs after the response.
 * @param req - Incoming request; requires the CRON_SECRET bearer token.
 * @returns JSON `{ skipped, version }` when gated, else 202 `{ started, version }`.
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

    after(() => runGtfsSync(startTime, version));

    return NextResponse.json({ started: true, version }, { status: 202 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[SYNC] Gate check failed", { error: msg });
    await recordIngestRun({
      endpoint: "gtfs/sync",
      startedAt: new Date(startTime),
      success: false,
      error: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
