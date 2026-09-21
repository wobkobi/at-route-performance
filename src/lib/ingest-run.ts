// src/lib/ingest-run.ts
// Record and read ingest-run outcomes, and project the footer's
// next-update time. Recording is best-effort so a logging failure never breaks
// the ingest request itself. Freshness prefers the last successful realtime run
// but falls back to the freshest recorded arrival until the first run is logged
// (e.g. just after deploy), clamping that fallback to now since a scheduled
// arrival can sit in the near future once the morning's timetable is loaded.

// From its own module rather than the `@/lib/data` barrel: the cache policy
// reads the last run to key a live window, and the barrel pulls in the modules
// that import that policy.
import { getLatestEventDate } from "@/lib/data/data-days";
import { prisma } from "@/lib/db";
import { memCache } from "@/lib/mem-cache";
import type { Prisma } from "@prisma/client";

/**
 * Realtime ingest cadence in seconds (cron-job.org posts to /api/ingest/at every
 * ~2 minutes). Used to project the footer's "next update" time from the last run.
 */
export const INGEST_INTERVAL_SEC = 120;

/** Truncate an error message so a single failure can't bloat a row. */
const MAX_ERROR_LEN = 500;

/** A single ingest run's outcome, as recorded by an /api/ingest/* endpoint. */
export interface IngestRunInput {
  /** Endpoint slug, e.g. "at", "gtfs/sync", "aggregate". */
  endpoint: string;
  /** When the handler started (its `new Date(startTime)`). */
  startedAt: Date;
  /** Whether the run completed without throwing. */
  success: boolean;
  /** Rows inserted/processed (endpoint-specific); omit when not meaningful. */
  count?: number;
  /** Error message when `success` is false. */
  error?: string;
  /**
   * Endpoint-specific record of what the run decided and did, for questions the
   * other columns cannot answer - the retention a cleanup applied, say, which
   * `count` alone cannot distinguish from a run that deleted nothing.
   */
  detail?: Prisma.InputJsonValue;
}

/**
 * Record one ingest run. Best-effort: any failure to write the log is swallowed
 * (and warned) so observability never breaks the ingest request itself.
 * @param run - The run's endpoint, timing, outcome, and optional count/error.
 * @returns Nothing; resolves once the write is attempted.
 */
export async function recordIngestRun(run: IngestRunInput): Promise<void> {
  try {
    await prisma.ingestRun.create({
      data: {
        endpoint: run.endpoint,
        startedAt: run.startedAt,
        success: run.success,
        count: run.count,
        error: run.error?.slice(0, MAX_ERROR_LEN),
        detail: run.detail,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.warn("[INGEST_RUN] Failed to record run", { endpoint: run.endpoint, error: msg });
  }
}

/** The most recent successful run for an endpoint. */
export interface LastIngestRun {
  /** When the run finished. */
  completedAt: Date;
  /** Rows it processed, when recorded. */
  count: number | null;
}

/**
 * How long one instance reuses a last-run lookup. The footer renders on every
 * page view and prefetch, so the indexed query is shared briefly, but never for
 * long enough to lap the ingest cadence.
 */
const LAST_RUN_TTL_SEC = 20;

/**
 * The newest successful run for an endpoint, for the data-freshness footer.
 *
 * Held in the in-process TTL cache rather than the Data Cache: `unstable_cache`
 * answers an expired entry with its stale value and only refreshes in the
 * background, so the first page view after a quiet spell would show a run from
 * whenever the entry was last written, and the footer reads that as a stalled
 * ingest. An expired `memCache` entry is refetched before it is returned,
 * capping the lag at {@link LAST_RUN_TTL_SEC}.
 * @param endpoint - Endpoint slug to look up (e.g. "at" for the realtime feed).
 * @returns The latest successful run, or null when none has been logged yet.
 */
export async function getLastIngestRun(endpoint: string): Promise<LastIngestRun | null> {
  return memCache(`last-ingest-run|${endpoint}`, LAST_RUN_TTL_SEC, async () => {
    const run = await prisma.ingestRun.findFirst({
      where: { endpoint, success: true },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true, count: true },
    });
    return run ? { completedAt: run.completedAt, count: run.count } : null;
  });
}

/** A resolved "last updated" instant plus the projected "next update" instant. */
export interface DataFreshness {
  /** When the data was last refreshed. */
  lastUpdated: Date;
  /** When the next refresh is expected (lastUpdated + cadence). */
  nextUpdate: Date;
  /**
   * Where the instant came from: a logged ingest run, or the freshest recorded
   * arrival while no run has been logged yet (a fresh deploy, or a reset of the
   * IngestRun collection). The footer words the two differently, since only a
   * run can be "due".
   */
  source: "run" | "event";
}

/**
 * Resolve the footer's freshness window from what is known. Prefers the last
 * successful realtime ingest run; falls back to the freshest recorded arrival
 * until the first run has been logged. The event fallback is the newest
 * scheduled arrival, which sits in the near future when the feed already
 * holds the morning's timetable, so it is clamped to now.
 * @param run - The last successful realtime run, or null.
 * @param latestEvent - The freshest recorded arrival, or null.
 * @param now - The current instant.
 * @returns The last-updated and next-update instants with their source, or null when there is no data.
 */
export function resolveFreshness(
  run: LastIngestRun | null,
  latestEvent: Date | null,
  now: Date,
): DataFreshness | null {
  // Normalise to a Date so getTime() works even if the instant arrives as an
  // ISO string (any JSON round trip turns a Date into one).
  const resolved = run ? new Date(run.completedAt) : latestEvent;
  if (!resolved) return null;
  const lastUpdated = resolved > now ? now : resolved;
  return {
    lastUpdated,
    nextUpdate: new Date(lastUpdated.getTime() + INGEST_INTERVAL_SEC * 1000),
    source: run ? "run" : "event",
  };
}

/**
 * The footer's freshness window (see {@link resolveFreshness}).
 * @returns The window, or null when there is no data at all.
 */
export async function getDataFreshness(): Promise<DataFreshness | null> {
  const run = await getLastIngestRun("at");
  return resolveFreshness(run, run ? null : await getLatestEventDate(), new Date());
}
