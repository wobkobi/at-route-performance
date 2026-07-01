// src/app/api/ingest/gtfs/stops/route.ts
/**
 * @description POST ingest endpoint that syncs GTFS stops from AT v3 into the Stop collection via batched upserts.
 */
import { requireCronAuth } from "@/lib/auth";
import { syncStops } from "@/lib/ingest";
import { NextResponse } from "next/server";

/**
 * Ingest GTFS stops from AT v3 into the Stop collection (batched upserts).
 * Optional `?date=YYYY-MM-DD` selects the service date.
 * @param req - Incoming request; requires the CRON_SECRET bearer token.
 * @returns JSON `{ inserted: number }`, 401 if unauthorised, 502 on failure.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const date = new URL(req.url).searchParams.get("date") ?? undefined;
    const { upserted } = await syncStops(date);
    return NextResponse.json({ inserted: upserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("[INGEST stops] failed", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
