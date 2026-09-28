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
// outage should watch `database`, not `ok` - and should alert on `databaseMs`
// as well, because the saturation this endpoint exists to catch degrades
// latency long before it fails outright.

import { recentCleanupRuns } from "@/lib/cleanup";
import { prisma } from "@/lib/db";
import { projectCleanupHealth } from "@/lib/health";
import { NextResponse } from "next/server";
import pkg from "../../../../package.json";

/** How long the database gets to answer before the probe calls it down. */
const DB_PROBE_TIMEOUT_MS = 5_000;

/**
 * Whether the database answers a real collection read inside
 * {@link DB_PROBE_TIMEOUT_MS}, and how long that read took.
 *
 * It reads one field of one `Route` rather than sending a `ping`, because the
 * two fail differently. A ping is an admin command the server answers promptly
 * while the query path behind it is degraded, so a read path that was queueing
 * or scanning still probed "up". `Route` is the collection the pool-cleared
 * outage threw on, so this travels the path a page render travels: a real
 * collection read through the same bounded pool.
 *
 * The duration is the more useful half. Saturation showed up as latency long
 * before it showed up as failure - p50 went from 11ms at one concurrent request
 * to 2,167ms at four, while every response stayed a 200 - so a monitor watching
 * only up/down cannot see the knee, and a threshold on `ms` can.
 *
 * What this still cannot see: each instance has its own connection pool, so the
 * answer describes the instance that served the probe rather than the fleet.
 *
 * The bound matters: an unreachable server otherwise holds the request open for
 * the driver's own server-selection timeout, about thirty seconds, so a monitor
 * would record the probe as hung rather than the database as down.
 * @returns "up" when the read answers in time, including when the collection is
 *   empty - an answer of "no documents" still proves the path works - and "down"
 *   when it errors or does not, with the elapsed milliseconds either way.
 */
async function probeDatabase(): Promise<{ status: "up" | "down"; ms: number }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = performance.now();
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("database probe timed out")), DB_PROBE_TIMEOUT_MS);
    });
    await Promise.race([prisma.route.findFirst({ select: { id: true } }), timeout]);
    return { status: "up", ms: Math.round(performance.now() - started) };
  } catch {
    return { status: "down", ms: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The deployed build's version, the server's clock, whether the database is
 * reachable and how long it took to say so, and the last cleanup run's
 * retention window.
 * @returns JSON `{ ok, version, time, database, databaseMs, cleanup }`.
 */
export async function GET(): Promise<NextResponse> {
  const { status: database, ms: databaseMs } = await probeDatabase();
  // Asking for the cleanup runs while the database is down would spend the
  // driver's full server-selection timeout to learn what the probe just said.
  const cleanup =
    database === "up"
      ? await recentCleanupRuns(10)
          .then(projectCleanupHealth)
          .catch(() => null)
      : null;
  return NextResponse.json(
    {
      ok: true,
      version: pkg.version,
      time: new Date().toISOString(),
      database,
      databaseMs,
      cleanup,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
