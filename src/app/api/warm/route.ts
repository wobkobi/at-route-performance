// src/app/api/warm/route.ts
// Cron-only POST that pre-computes completed days into the Data Cache so the
// first reader to step onto one never pays for a cold day. Two parts: yesterday's
// three per-day board aggregations on the default filter variant (the keys the
// week and month views compose), answered in the response; then every day page
// at each of the last seven completed days, rendered after the 202 so each page
// fills exactly the keys it reads. Entries are written by the deployment that
// runs this, so pointing cron-job.org at production warms the production cache.
// Not an ingest: it writes no data and records no IngestRun.

import { requireCronAuth } from "@/lib/auth";
import { cachedWorstRoutesOfDay, cachedWorstStopsOfDay, cachedWorstTripsOfDay } from "@/lib/data";
import { WEEK_REVALIDATE } from "@/lib/shame-page";
import { nzServiceDayString } from "@/lib/time";
import { forEachLimited, pageWarmPaths } from "@/lib/warm";
import { after, NextResponse } from "next/server";

// Seven cold days of seven pages can run for minutes on the first night; the
// page renders happen after the 202 is sent, inside this budget.
export const maxDuration = 300;

/**
 * Page renders in flight at once. Each cold render runs several day-sized
 * aggregations, so this is kept low enough that the warm never stacks them up
 * on the database.
 */
const PAGE_CONCURRENCY = 3;

/**
 * Render each day page once, so its data reads land in the Data Cache under
 * the keys a reader's request will look up. Invoked via `after` so the 202 is
 * sent first: the external scheduler drops a request at 30s. A failed page is
 * logged and skipped, never retried, since the next reader fills it anyway.
 * @param origin - The deployment's own origin, taken from the cron request.
 * @param yesterday - The most recently completed service date (`YYYY-MM-DD`).
 */
async function warmPages(origin: string, yesterday: string): Promise<void> {
  const startTime = Date.now();
  const paths = pageWarmPaths(yesterday);
  const failed: string[] = [];
  let slowest = { path: "", ms: 0 };
  await forEachLimited(paths, PAGE_CONCURRENCY, async (path) => {
    const pageStart = Date.now();
    try {
      // A redirect means the day moved out from under the list, so count it
      // rather than follow it into a page that is not the one asked for.
      const res = await fetch(new URL(path, origin), { redirect: "manual", cache: "no-store" });
      // Drain the body: the page streams, and a Suspense boundary's data read
      // finishes only when its part of the stream does.
      await res.arrayBuffer();
      if (!res.ok) failed.push(`${path} ${res.status}`);
    } catch (err) {
      failed.push(`${path} ${err instanceof Error ? err.message : String(err)}`);
    }
    const ms = Date.now() - pageStart;
    if (ms > slowest.ms) slowest = { path, ms };
  });
  const summary = { pages: paths.length, failed, slowest, duration_ms: Date.now() - startTime };
  if (failed.length > 0) console.error("[WARM] Pages failed", summary);
  else console.log("[WARM] Pages warmed", summary);
}

/**
 * Warm yesterday's per-day shame-board cache entries, then the last week of
 * day pages in the background. Schedule after the nightly aggregate + cleanup,
 * so yesterday is warmed under its final key.
 * @param req - Request carrying the cron bearer token.
 * @returns 202 JSON `{ date, trips, routes, stops, pages, duration_ms }`, 401/500 on failure.
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
    after(() => warmPages(new URL(req.url).origin, yesterday));
    return NextResponse.json(
      {
        date: yesterday,
        trips: trips.length,
        routes: routes.length,
        stops: stops.length,
        pages: pageWarmPaths(yesterday).length,
        duration_ms: Date.now() - startTime,
      },
      { status: 202 },
    );
  } catch (err) {
    console.error("[WARM] Failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "warm failed" }, { status: 500 });
  }
}
