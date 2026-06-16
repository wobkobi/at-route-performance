// src/app/api/ingest/gtfs/sync/route.ts
import { requireCronAuth } from "@/lib/auth";
import { syncRoutes, syncStops } from "@/lib/ingest";
import { NextResponse } from "next/server";

/**
 * Orchestrator: sync GTFS static data (routes + stops) in-process.
 * Scheduled daily via Vercel Cron (see vercel.json).
 * @param req - Incoming request; requires the CRON_SECRET bearer token.
 * @returns JSON `{ routes, stops, total_duration_ms, timestamp }`.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const startTime = Date.now();

  const denied = requireCronAuth(req);
  if (denied) return denied;

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

    const totalDuration = Date.now() - startTime;
    const result = {
      routes: { ...routes, duration_ms: routesDuration },
      stops: { ...stops, duration_ms: stopsDuration },
      total_duration_ms: totalDuration,
      timestamp: new Date().toISOString(),
    };

    console.log("[SYNC] Complete", {
      total_duration_ms: totalDuration,
      routes: routes.upserted,
      stops: stops.upserted,
    });

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[SYNC] Failed", {
      error: msg,
      duration_ms: Date.now() - startTime,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
