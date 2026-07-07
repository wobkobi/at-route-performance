// src/app/api/warm/route.ts
/**
 * @description Cron-only POST that pre-computes yesterday's shame boards into
 * the Data Cache so the first visitor to a week or month view never pays for a
 * cold day. Warms the default filter variant (all modes, school excluded) of
 * the three per-day board aggregations - the exact cache keys the boards read -
 * plus the navigation-bound markers, which shift after the nightly cleanup.
 * Entries are written by the deployment that runs this, so pointing cron-job.org
 * at production warms the production cache. Not an ingest: it writes no data
 * and records no IngestRun.
 */
import { requireCronAuth } from "@/lib/auth";
import {
  cachedWorstRoutesOfDay,
  cachedWorstStopsOfDay,
  cachedWorstTripsOfDay,
  getEarliestDataDay,
  getLatestEventDate,
} from "@/lib/data";
import { WEEK_REVALIDATE } from "@/lib/shame-page";
import { nzServiceDayString } from "@/lib/time";
import { NextResponse } from "next/server";

// Three single-day aggregations plus two point lookups fit well within this.
export const maxDuration = 60;

/**
 * Warm yesterday's per-day shame-board cache entries and the earliest/latest
 * data markers. Schedule after the nightly aggregate + cleanup.
 * @param req - Request carrying the cron bearer token.
 * @returns JSON `{ date, trips, routes, stops, duration_ms }`, 401/500 on failure.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  const startTime = Date.now();

  try {
    const yesterday = nzServiceDayString(new Date(Date.now() - 86_400_000));
    const [trips, routes, stops] = await Promise.all([
      cachedWorstTripsOfDay(yesterday, null, false, WEEK_REVALIDATE),
      cachedWorstRoutesOfDay(yesterday, null, false, WEEK_REVALIDATE),
      cachedWorstStopsOfDay(yesterday, null, false, WEEK_REVALIDATE),
    ]);
    // Refresh the stepper bounds too: cleanup moves the earliest day nightly.
    await Promise.all([getEarliestDataDay(1), getLatestEventDate()]);

    return NextResponse.json({
      date: yesterday,
      trips: trips.length,
      routes: routes.length,
      stops: stops.length,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error("[WARM] failed", err);
    return NextResponse.json({ error: "warm failed" }, { status: 500 });
  }
}
