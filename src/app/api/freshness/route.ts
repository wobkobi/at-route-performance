// src/app/api/freshness/route.ts
/**
 * @description Public read-only endpoint the footer polls to keep its
 * "last updated / next update" line live while a tab sits open. Backed by the
 * same cached lookup the server render uses, so polling stays cheap.
 */
import { getDataFreshness } from "@/lib/ingest-run";
import { NextResponse } from "next/server";

/**
 * Current data freshness for the footer poller.
 * @returns JSON `{ lastUpdated, nextUpdate }` as ISO strings, both null when no
 * data has been ingested yet.
 */
export async function GET(): Promise<NextResponse> {
  const freshness = await getDataFreshness();
  if (!freshness) {
    return NextResponse.json({ lastUpdated: null, nextUpdate: null });
  }
  return NextResponse.json({
    lastUpdated: freshness.lastUpdated.toISOString(),
    nextUpdate: freshness.nextUpdate.toISOString(),
  });
}
