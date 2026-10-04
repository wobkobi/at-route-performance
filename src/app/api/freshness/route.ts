// src/app/api/freshness/route.ts
// Public read-only endpoint the footer polls to keep its
// "last updated / next update" line live while a tab sits open. Backed by the
// same cached lookup the server render uses, so polling stays cheap.

import { readFailed } from "@/lib/api-error";
import { getDataFreshness } from "@/lib/feed/ingest-run";
import { NextResponse } from "next/server";

/**
 * Held briefly at the CDN: every open tab polls once a minute, and a run lands
 * every two, so thirty seconds shares the read without hiding a new run for long.
 */
const CACHE_CONTROL = "public, max-age=0, s-maxage=30, stale-while-revalidate=30";

/**
 * Current data freshness for the footer poller.
 * @returns JSON `{ lastUpdated, nextUpdate, source }` (ISO strings and "run" or
 *   "event"), all null when no data has been ingested yet; 503/500 when the read fails.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const freshness = await getDataFreshness();
    const body = freshness
      ? {
          lastUpdated: freshness.lastUpdated.toISOString(),
          nextUpdate: freshness.nextUpdate.toISOString(),
          source: freshness.source,
        }
      : { lastUpdated: null, nextUpdate: null, source: null };
    return NextResponse.json(body, { headers: { "Cache-Control": CACHE_CONTROL } });
  } catch (err) {
    return readFailed("api-freshness", err);
  }
}
