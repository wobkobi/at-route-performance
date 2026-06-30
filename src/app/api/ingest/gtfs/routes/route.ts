// src/app/api/ingest/gtfs/routes/route.ts
/**
 * @description POST ingest endpoint that syncs GTFS routes from AT v3 into the Route collection via batched upserts.
 */
import { requireCronAuth } from "@/lib/auth";
import { syncRoutes } from "@/lib/ingest";
import { NextResponse } from "next/server";

/**
 * Ingest GTFS routes from AT v3 into the Route collection (batched upserts).
 * @param req - Incoming request; requires the CRON_SECRET bearer token.
 * @returns JSON `{ inserted: number }`, 401 if unauthorised, 502 on failure.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const { upserted } = await syncRoutes();
    return NextResponse.json({ inserted: upserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("[INGEST routes] failed", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
