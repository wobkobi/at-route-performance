// src/app/api/health/route.ts
// Public liveness probe for the post-deploy check: answers with the deployed
// package version so a deploy can be confirmed to be the commit it claims, plus
// the retention window the last cleanup run actually used, so "what is
// production keeping" is answerable without a mongosh session. The cleanup
// block is best-effort - `ok` still says only that the build is up, and a
// database outage leaves the block null rather than failing the probe.

import { recentCleanupRuns } from "@/lib/cleanup";
import { projectCleanupHealth } from "@/lib/health";
import { NextResponse } from "next/server";
import pkg from "../../../../package.json";

/**
 * The deployed build's version, the server's clock and the last cleanup run's
 * retention window.
 * @returns JSON `{ ok, version, time, cleanup }`.
 */
export async function GET(): Promise<NextResponse> {
  const cleanup = await recentCleanupRuns(10)
    .then(projectCleanupHealth)
    .catch(() => null);
  return NextResponse.json(
    { ok: true, version: pkg.version, time: new Date().toISOString(), cleanup },
    { headers: { "cache-control": "no-store" } },
  );
}
