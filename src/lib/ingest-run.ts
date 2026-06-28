// src/lib/ingest-run.ts
import { getLatestEventDate } from "@/lib/data";
import { prisma } from "@/lib/db";
import { unstable_cache } from "@/lib/mem-cache";

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
 * The newest successful run for an endpoint, for the data-freshness footer.
 * Cached briefly so the footer query is cheap under the page's revalidation.
 * @param endpoint - Endpoint slug to look up (e.g. "at" for the realtime feed).
 * @returns The latest successful run, or null when none has been logged yet.
 */
export async function getLastIngestRun(endpoint: string): Promise<LastIngestRun | null> {
  return unstable_cache(
    async () => {
      const run = await prisma.ingestRun.findFirst({
        where: { endpoint, success: true },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true, count: true },
      });
      return run ? { completedAt: run.completedAt, count: run.count } : null;
    },
    ["last-ingest-run", endpoint],
    { revalidate: 60 },
  )();
}

/** A resolved "last updated" instant plus the projected "next update" instant. */
export interface DataFreshness {
  /** When the data was last refreshed. */
  lastUpdated: Date;
  /** When the next refresh is expected (lastUpdated + cadence). */
  nextUpdate: Date;
}

/**
 * Resolve the footer's freshness window. Prefers the last successful realtime
 * ingest run; falls back to the freshest recorded arrival ({@link getLatestEventDate})
 * until the first run has been logged (e.g. immediately after deploy).
 * @returns The last-updated and next-update instants, or null when there is no data.
 */
export async function getDataFreshness(): Promise<DataFreshness | null> {
  const run = await getLastIngestRun("at");
  // unstable_cache JSON-serialises Date objects to strings; convert back so
  // getTime() calls below work whether the value came from cache or Prisma.
  const resolved = run ? new Date(run.completedAt) : await getLatestEventDate();
  if (!resolved) return null;
  // The event-date fallback is the newest *scheduled* arrival, which sits in the
  // near future when the feed already holds the morning's timetable - clamp so
  // "last updated" never reads as a future time. Real ingest-run times are past.
  const now = new Date();
  const lastUpdated = resolved > now ? now : resolved;
  return {
    lastUpdated,
    nextUpdate: new Date(lastUpdated.getTime() + INGEST_INTERVAL_SEC * 1000),
  };
}
