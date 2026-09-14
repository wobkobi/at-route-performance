// src/lib/cleanup.ts
// Retention: the cutoff rule, the request parameter rules and the delete run
// behind POST /api/ingest/cleanup. The run takes its storage as a small port so
// a test can drive it with an in-memory fake; the route passes the Prisma one.
import { prisma, runCommand } from "@/lib/db";
import { nzServiceDayRange } from "@/lib/time";

/** Retention in days when neither the request nor the environment says. */
export const DEFAULT_RETENTION_DAYS = 14;

/** Retention below this many days needs `?force=1`, against an accidental purge. */
export const FORCE_BELOW_DAYS = 7;

/** Storage allowance in MB when `STORAGE_LIMIT_MB` is unset. */
export const DEFAULT_STORAGE_LIMIT_MB = 512;

/** What the cleanup run needs from storage. */
export interface CleanupStore {
  /** Arrival events scheduled before the instant. */
  countEvents(before: Date): Promise<number>;
  /** Trip delays stamped before the instant. */
  countTrips(before: Date): Promise<number>;
  /** Delete arrival events scheduled before the instant; resolves to the count. */
  deleteEvents(before: Date): Promise<number>;
  /** Delete trip delays stamped before the instant; resolves to the count. */
  deleteTrips(before: Date): Promise<number>;
  /** Delete daily summaries for service days before the instant; resolves to the count. */
  deleteSummaries(before: Date): Promise<number>;
  /** Delete off-route sightings taken before the instant; resolves to the count. */
  deleteSightings(before: Date): Promise<number>;
  /** On-disk size of data and indexes in MB, and the document count. */
  storage(): Promise<{ dataMB: number; indexMB: number; objects: number }>;
}

/**
 * Arrival events scheduled before an instant.
 * @param before - The cutoff.
 * @returns The count.
 */
function countEvents(before: Date): Promise<number> {
  return prisma.arrivalEvent.count({ where: { scheduledAt: { lt: before } } });
}

/**
 * Trip delays stamped before an instant.
 * @param before - The cutoff.
 * @returns The count.
 */
function countTrips(before: Date): Promise<number> {
  return prisma.tripDelay.count({ where: { timestamp: { lt: before } } });
}

/**
 * Delete arrival events scheduled before an instant.
 * @param before - The cutoff.
 * @returns The count deleted.
 */
async function deleteEvents(before: Date): Promise<number> {
  return (await prisma.arrivalEvent.deleteMany({ where: { scheduledAt: { lt: before } } })).count;
}

/**
 * Delete trip delays stamped before an instant.
 * @param before - The cutoff.
 * @returns The count deleted.
 */
async function deleteTrips(before: Date): Promise<number> {
  return (await prisma.tripDelay.deleteMany({ where: { timestamp: { lt: before } } })).count;
}

/**
 * Delete daily summaries for service days before an instant.
 * @param before - The cutoff.
 * @returns The count deleted.
 */
async function deleteSummaries(before: Date): Promise<number> {
  return (await prisma.dailyRouteSummary.deleteMany({ where: { date: { lt: before } } })).count;
}

/**
 * Delete off-route sightings taken before an instant.
 * @param before - The cutoff.
 * @returns The count deleted.
 */
async function deleteSightings(before: Date): Promise<number> {
  return (await prisma.offRouteSighting.deleteMany({ where: { seenAt: { lt: before } } })).count;
}

/**
 * Real on-disk sizes from dbStats (compressed data plus indexes); a per-event
 * byte estimate overstated usage by about 2x.
 * @returns Data and index sizes in MB and the document count.
 */
async function storage(): Promise<{ dataMB: number; indexMB: number; objects: number }> {
  const stats = (await runCommand(() => prisma.$runCommandRaw({ dbStats: 1 }))) as {
    storageSize?: number;
    indexSize?: number;
    objects?: number;
  };
  return {
    dataMB: Number(stats.storageSize ?? 0) / 1_048_576,
    indexMB: Number(stats.indexSize ?? 0) / 1_048_576,
    objects: Number(stats.objects ?? 0),
  };
}

/** The Prisma-backed store the route uses. */
export const prismaCleanupStore: CleanupStore = {
  countEvents,
  countTrips,
  deleteEvents,
  deleteTrips,
  deleteSummaries,
  deleteSightings,
  storage,
};

/**
 * The instant rows older than a retention window are deleted before: the NZ
 * service-day start (5am Auckland) of the day that many days ago. Snapping to
 * the service day keeps a late-night run (11pm to 5am) with the day it belongs
 * to; a UTC-midnight cutoff would drop the tail of the day before the cutoff.
 * @param days - Retention in days.
 * @param now - The current instant.
 * @returns The cutoff instant.
 */
export function cleanupCutoff(days: number, now: Date = new Date()): Date {
  return nzServiceDayRange(new Date(now.getTime() - days * 86_400_000)).start;
}

/** A validated cleanup request. */
export interface CleanupParams {
  retentionDays: number;
  /** DailyRouteSummary retention in days, or null to leave the summaries alone. */
  summaryDays: number | null;
}

/** Why a cleanup request was refused. */
export interface CleanupRefusal {
  error: string;
  hint?: string;
}

/**
 * Validate the cleanup request's query parameters against the environment's
 * default retention. Retention below {@link FORCE_BELOW_DAYS} days needs
 * `?force=1`, so a typo cannot purge the archive.
 * @param url - The request URL.
 * @param envRetention - `RETENTION_DAYS` from the environment, if set.
 * @returns The params, or the refusal to send back as a 400.
 */
export function parseCleanupParams(
  url: URL,
  envRetention: string | undefined,
): { ok: true; params: CleanupParams } | { ok: false; refusal: CleanupRefusal } {
  const retentionParam = url.searchParams.get("retentionDays");
  const retentionDays = retentionParam
    ? parseInt(retentionParam, 10)
    : parseInt(envRetention || String(DEFAULT_RETENTION_DAYS), 10);
  const summaryDaysParam = url.searchParams.get("summaryDays");
  const summaryDays = summaryDaysParam ? parseInt(summaryDaysParam, 10) : null;

  if (Number.isNaN(retentionDays) || retentionDays < 1) {
    return { ok: false, refusal: { error: "Invalid retentionDays. Must be >= 1" } };
  }
  if (summaryDays !== null && (Number.isNaN(summaryDays) || summaryDays < 1)) {
    return { ok: false, refusal: { error: "Invalid summaryDays. Must be >= 1" } };
  }
  if (retentionDays < FORCE_BELOW_DAYS && !url.searchParams.has("force")) {
    return {
      ok: false,
      refusal: {
        error: `Retention < ${FORCE_BELOW_DAYS} days requires ?force=1 parameter`,
        hint: "This prevents accidental aggressive deletion",
      },
    };
  }
  return { ok: true, params: { retentionDays, summaryDays } };
}

/** What a cleanup run did. */
export interface CleanupOutcome {
  deletedEvents: number;
  deletedTrips: number;
  deletedSummaries: number;
  deletedSightings: number;
  /** The first failure among the deletes, or null when all succeeded. */
  firstError: string | null;
  errors: { events?: string; trips?: string; summaries?: string; sightings?: string };
  /** Storage after the run, and whether it sits past 80% of the allowance. */
  storage: { usedMB: number; dataMB: number; indexMB: number; objects: number; limitMB: number };
  storageWarning: boolean;
}

/**
 * Run one collection's delete, recording a failure instead of throwing so the
 * other collections still run.
 * @param errors - Where a failure message is recorded.
 * @param key - The collection being deleted.
 * @param run - Performs the delete and resolves to the count.
 * @returns The count deleted, or 0 after a failure.
 */
async function attemptDelete(
  errors: CleanupOutcome["errors"],
  key: keyof CleanupOutcome["errors"],
  run: () => Promise<number>,
): Promise<number> {
  try {
    return await run();
  } catch (err) {
    errors[key] = err instanceof Error ? err.message : "Unknown error";
    return 0;
  }
}

/**
 * Run the retention deletes. Each collection deletes on its own with its own
 * error, so one failure never skips the others; the outcome carries every
 * error and the storage reading for the caller to log and record.
 * @param store - The storage port.
 * @param cutoff - Delete rows scheduled, stamped or seen before this instant.
 * @param summaryDays - DailyRouteSummary retention in days, or null to skip.
 * @param limitMB - The storage allowance in MB.
 * @param now - The current instant, for the summary cutoff.
 * @returns What was deleted, what failed and how full storage is.
 */
export async function runCleanup(
  store: CleanupStore,
  cutoff: Date,
  summaryDays: number | null,
  limitMB: number = DEFAULT_STORAGE_LIMIT_MB,
  now: Date = new Date(),
): Promise<CleanupOutcome> {
  const errors: CleanupOutcome["errors"] = {};
  const deletedEvents = await attemptDelete(errors, "events", () => store.deleteEvents(cutoff));
  const deletedTrips = await attemptDelete(errors, "trips", () => store.deleteTrips(cutoff));
  const deletedSightings = await attemptDelete(errors, "sightings", () =>
    store.deleteSightings(cutoff),
  );
  const deletedSummaries =
    summaryDays === null
      ? 0
      : await attemptDelete(errors, "summaries", () =>
          store.deleteSummaries(cleanupCutoff(summaryDays, now)),
        );

  const { dataMB, indexMB, objects } = await store.storage();
  const usedMB = dataMB + indexMB;
  return {
    deletedEvents,
    deletedTrips,
    deletedSummaries,
    deletedSightings,
    firstError: errors.events ?? errors.trips ?? errors.summaries ?? errors.sightings ?? null,
    errors,
    storage: { usedMB, dataMB, indexMB, objects, limitMB },
    storageWarning: usedMB > limitMB * 0.8,
  };
}
