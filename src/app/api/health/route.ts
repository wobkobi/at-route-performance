// src/app/api/health/route.ts
// Public liveness probe for the post-deploy check: answers with the deployed
// package version so a deploy can be confirmed to be the commit it claims, plus
// the retention window the last cleanup run actually used, so "what is
// production keeping" is answerable without a mongosh session.
//
// `ok` says only that the build is up, which is what the deploy check asks.
// Whether the database is reachable is a separate question with a separate
// answer, `database`, because the two fail independently: the site can be
// serving while the NAS is unreachable. An uptime monitor watching for an
// outage should watch `database`, not `ok`.

import { recentCleanupRuns } from "@/lib/cleanup";
import { prisma } from "@/lib/db";
import { projectCleanupHealth } from "@/lib/health";
import { NextResponse } from "next/server";
import pkg from "../../../../package.json";

/** How long the database gets to answer before the probe calls it down. */
const DB_PROBE_TIMEOUT_MS = 5_000;

/**
 * Whether the database answers a ping inside {@link DB_PROBE_TIMEOUT_MS}. The
 * bound matters: an unreachable server otherwise holds the request open for the
 * driver's own server-selection timeout, about thirty seconds, so a monitor
 * would record the probe as hung rather than the database as down.
 * @returns "up" when it answers in time, "down" when it errors or does not.
 */
async function probeDatabase(): Promise<"up" | "down"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("database probe timed out")), DB_PROBE_TIMEOUT_MS);
    });
    await Promise.race([prisma.$runCommandRaw({ ping: 1 }), timeout]);
    return "up";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The deployed build's version, the server's clock, whether the database is
 * reachable, and the last cleanup run's retention window.
 * @returns JSON `{ ok, version, time, database, cleanup }`.
 */
export async function GET(): Promise<NextResponse> {
  const database = await probeDatabase();
  // Asking for the cleanup runs while the database is down would spend the
  // driver's full server-selection timeout to learn what the probe just said.
  const cleanup =
    database === "up"
      ? await recentCleanupRuns(10)
          .then(projectCleanupHealth)
          .catch(() => null)
      : null;
  return NextResponse.json(
    { ok: true, version: pkg.version, time: new Date().toISOString(), database, cleanup },
    { headers: { "cache-control": "no-store" } },
  );
}
