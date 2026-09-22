// src/lib/cleanup.ts
// Retention: the cutoff rule, the request parameter rules and the delete run
// behind POST /api/ingest/cleanup. The run takes its storage as a small port so
// a test can drive it with an in-memory fake; the route passes the Prisma one.
import { prisma, runCommand } from "@/lib/db";
import { nzServiceDayRange } from "@/lib/time";

/**
 * Retention floor in days. A request under this is refused outright, and
 * `?force=1` does not lift it: the archive is kept for ten years, so any value
 * this low is a lost environment variable or a typo rather than an intention.
 * There is deliberately no default retention to pair with it - a missing
 * `RETENTION_DAYS` must refuse, not quietly mean a fortnight.
 */
export const MIN_SAFE_RETENTION_DAYS = 365;

/**
 * Summary retention below this many days needs `?force=1`. Summaries are
 * derived from the arrivals and can be rebuilt, so they get the lighter guard
 * rather than {@link MIN_SAFE_RETENTION_DAYS}.
 */
export const FORCE_BELOW_DAYS = 7;

/**
 * Share of the arrival archive one run may delete before it refuses. A correct
 * nightly run at a ten-year window deletes nothing at all, so anything past a
 * fiftieth of the collection means the window moved, not that a day aged out.
 */
export const MAX_DELETE_SHARE = 0.02;

/**
 * How many days a cutoff may advance past the last applied one before it
 * refuses. The nightly run advances exactly one day; two absorbs a missed run.
 */
export const MAX_CUTOFF_ADVANCE_DAYS = 2;

/** Storage allowance in MB when `STORAGE_LIMIT_MB` is unset. */
export const DEFAULT_STORAGE_LIMIT_MB = 262_144;

/** What the cleanup run needs from storage. */
export interface CleanupStore {
  /** Arrival events scheduled before the instant. */
  countEvents(before: Date): Promise<number>;
  /** Every arrival event on record, for the share the run would delete. */
  countAllEvents(): Promise<number>;
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
  /** Delete stop closures that ended before the instant; resolves to the count. */
  deleteClosures(before: Date): Promise<number>;
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
 * Every arrival event on record, read through the `count` command rather than
 * `prisma.arrivalEvent.count()`. An unfiltered Prisma count runs
 * `countDocuments`, which scans all 3M+ documents; the raw command with no
 * query answers from collection metadata instead. The share guard only needs a
 * denominator, so metadata accuracy is ample.
 * @returns The count.
 */
async function countAllEvents(): Promise<number> {
  const res = (await runCommand(() => prisma.$runCommandRaw({ count: "ArrivalEvent" }))) as {
    n?: number;
  };
  return Number(res.n ?? 0);
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
 * Delete stop closures that ended before an instant. One still open stays
 * however old it is: the closure is still in force.
 * @param before - The cutoff.
 * @returns The count deleted.
 */
async function deleteClosures(before: Date): Promise<number> {
  return (await prisma.stopClosure.deleteMany({ where: { to: { lt: before } } })).count;
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
  countAllEvents,
  countTrips,
  deleteEvents,
  deleteTrips,
  deleteSummaries,
  deleteSightings,
  deleteClosures,
  storage,
};

/**
 * The instant rows older than a retention window are deleted before: the NZ
 * service-day start (4am Auckland) of the day that many days ago. Snapping to
 * the service day keeps a late-night run (11pm to 4am) with the day it belongs
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
  /** `?force=1` was passed: the share and cutoff-advance guards stand down. */
  force: boolean;
  /** `?dryRun=1` was passed: plan the run and record it, but delete nothing. */
  dryRun: boolean;
}

/** Why a cleanup request was refused. */
export interface CleanupRefusal {
  error: string;
  hint?: string;
}

/**
 * Validate the cleanup request's query parameters against the environment's
 * retention. The checks here are the ones that need no database read, so the
 * route can answer them as a 400 before it acknowledges; the share and
 * cutoff-advance guards need counts and live in {@link checkCleanupPlan}.
 *
 * A missing or unparseable `RETENTION_DAYS` refuses. There is no default to
 * fall back to on purpose: a fallback is how an environment that loses the
 * variable deletes a ten-year archive while reporting success.
 * @param url - The request URL.
 * @param envRetention - `RETENTION_DAYS` from the environment, if set.
 * @returns The params, or the refusal to send back as a 400.
 */
export function parseCleanupParams(
  url: URL,
  envRetention: string | undefined,
): { ok: true; params: CleanupParams } | { ok: false; refusal: CleanupRefusal } {
  const force = url.searchParams.has("force");
  const dryRun = url.searchParams.has("dryRun");
  const source = url.searchParams.get("retentionDays") ?? envRetention;
  if (!source?.trim()) {
    return {
      ok: false,
      refusal: {
        error: "RETENTION_DAYS is not set",
        hint: "Set RETENTION_DAYS in the environment, or pass ?retentionDays=N. There is no default: a missing value refuses rather than deleting.",
      },
    };
  }
  const retentionDays = parseInt(source, 10);
  const summaryDaysParam = url.searchParams.get("summaryDays");
  const summaryDays = summaryDaysParam ? parseInt(summaryDaysParam, 10) : null;

  if (Number.isNaN(retentionDays) || retentionDays < 1) {
    return { ok: false, refusal: { error: "Invalid retentionDays. Must be >= 1" } };
  }
  if (summaryDays !== null && (Number.isNaN(summaryDays) || summaryDays < 1)) {
    return { ok: false, refusal: { error: "Invalid summaryDays. Must be >= 1" } };
  }
  if (retentionDays < MIN_SAFE_RETENTION_DAYS) {
    return {
      ok: false,
      refusal: {
        error: `Retention of ${retentionDays} days is below the ${MIN_SAFE_RETENTION_DAYS}-day floor`,
        hint: "?force=1 does not lift this. A value this low is a lost environment variable rather than an intention; move the floor deliberately if the archive really is meant to shrink.",
      },
    };
  }
  if (summaryDays !== null && summaryDays < FORCE_BELOW_DAYS && !force) {
    return {
      ok: false,
      refusal: {
        error: `Summary retention < ${FORCE_BELOW_DAYS} days requires ?force=1 parameter`,
        hint: "This prevents accidental aggressive deletion",
      },
    };
  }
  return { ok: true, params: { retentionDays, summaryDays, force, dryRun } };
}

/** A cleanup request costed against the archive, before the guards judge it. */
export interface CleanupPlan {
  retentionDays: number;
  /** DailyRouteSummary retention in days, or null to leave the summaries alone. */
  summaryDays: number | null;
  /** Delete rows scheduled, stamped or seen before this instant. */
  cutoff: Date;
  /** Arrival events the run would delete. */
  doomedEvents: number;
  /** Arrival events on record. */
  totalEvents: number;
  /** Share of the archive the run would delete; 0 when the collection is empty. */
  share: number;
  /** Whether this is a dry run. */
  dryRun: boolean;
}

/** A guard's judgement on a plan. */
export type CleanupVerdict =
  { ok: true } | { ok: false; reason: "share" | "cutoffAdvance"; message: string };

/**
 * Cost a validated request against the archive.
 * @param params - The validated request.
 * @param counts - Events the run would delete, and events on record.
 * @param counts.doomedEvents - Arrival events the run would delete.
 * @param counts.totalEvents - Arrival events on record.
 * @param now - The current instant, for the cutoff.
 * @returns The plan for {@link checkCleanupPlan} to judge.
 */
export function buildCleanupPlan(
  params: CleanupParams,
  counts: { doomedEvents: number; totalEvents: number },
  now: Date = new Date(),
): CleanupPlan {
  const { doomedEvents, totalEvents } = counts;
  return {
    retentionDays: params.retentionDays,
    summaryDays: params.summaryDays,
    dryRun: params.dryRun,
    cutoff: cleanupCutoff(params.retentionDays, now),
    doomedEvents,
    totalEvents,
    share: totalEvents === 0 ? 0 : doomedEvents / totalEvents,
  };
}

/**
 * Judge a costed plan against the two guards that need the database: the share
 * of the archive it would delete, and how far its cutoff jumps past the last
 * run that actually deleted. Both stand down under `?force=1`; the retention
 * floor in {@link parseCleanupParams} does not.
 * @param plan - The costed plan.
 * @param lastCutoff - Cutoff of the last applied run, or null when none is on record.
 * @param force - Whether `?force=1` was passed.
 * @returns The verdict, carrying the message to log and record on a refusal.
 */
export function checkCleanupPlan(
  plan: CleanupPlan,
  lastCutoff: Date | null,
  force: boolean,
): CleanupVerdict {
  if (force) return { ok: true };
  if (plan.share > MAX_DELETE_SHARE) {
    const pct = (plan.share * 100).toFixed(1);
    const ceiling = (MAX_DELETE_SHARE * 100).toFixed(0);
    return {
      ok: false,
      reason: "share",
      message: `Refusing to delete ${plan.doomedEvents} of ${plan.totalEvents} arrival events (${pct}%), over the ${ceiling}% ceiling`,
    };
  }
  if (lastCutoff) {
    const advance = (plan.cutoff.getTime() - lastCutoff.getTime()) / 86_400_000;
    if (advance > MAX_CUTOFF_ADVANCE_DAYS) {
      return {
        ok: false,
        reason: "cutoffAdvance",
        message: `Refusing a cutoff ${advance.toFixed(1)} days past the last applied run, over the ${MAX_CUTOFF_ADVANCE_DAYS}-day ceiling`,
      };
    }
  }
  return { ok: true };
}

/**
 * The cutoff of the newest run that actually deleted. A dry run and a refused
 * run each record a cutoff without applying it, and neither may become the
 * baseline the advance guard measures against: that would let a dry run at a
 * bad retention quietly authorise the real one the next night.
 * @param runs - Recorded cleanup runs, newest first, each with its `detail`.
 * @returns The cutoff, or null when no applied run is on record.
 */
export function pickLastAppliedCutoff(runs: { detail: unknown }[]): Date | null {
  for (const { detail } of runs) {
    if (!detail || typeof detail !== "object") continue;
    const { applied, cutoff } = detail as { applied?: unknown; cutoff?: unknown };
    if (applied !== true || typeof cutoff !== "string") continue;
    const at = new Date(cutoff);
    if (!Number.isNaN(at.getTime())) return at;
  }
  return null;
}

/** What a cleanup run records on `IngestRun.detail`, whatever it decided. */
export interface CleanupRunDetail {
  retentionDays: number;
  /** DailyRouteSummary retention in days, or null when the summaries were left alone. */
  summaryDays: number | null;
  /** ISO cutoff the run planned against. */
  cutoff: string;
  doomedEvents: number;
  doomedTrips: number;
  totalEvents: number;
  share: number;
  /** ISO cutoff of the last applied run the guard measured against, or null. */
  lastAppliedCutoff: string | null;
  forced: boolean;
  /** Whether the deletes actually ran: not a dry run, not refused. */
  applied: boolean;
  dryRun: boolean;
  /** Why a guard refused, or null. */
  refused: string | null;
  deleted?: {
    events: number;
    trips: number;
    summaries: number;
    sightings: number;
    closures: number;
  };
  storage?: { usedMB: number; limitMB: number };
}

/** A recorded cleanup run, as the health probe and the advance guard read it. */
export interface RecordedCleanupRun {
  completedAt: Date;
  success: boolean;
  detail: CleanupRunDetail | null;
}

/**
 * The most recent cleanup runs and what each recorded, newest first. Rides the
 * existing `[endpoint, completedAt]` index.
 * @param take - How many runs to read.
 * @returns The runs, newest first.
 */
export async function recentCleanupRuns(take = 10): Promise<RecordedCleanupRun[]> {
  const runs = await prisma.ingestRun.findMany({
    where: { endpoint: "cleanup" },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true, success: true, detail: true },
    take,
  });
  return runs.map((run) => ({
    completedAt: run.completedAt,
    success: run.success,
    // Prisma types the column as JsonValue. The only writer is this module's own
    // route, so the shape is ours to assert rather than to parse back.
    detail: run.detail ? (run.detail as unknown as CleanupRunDetail) : null,
  }));
}

/** What a cleanup run did. */
export interface CleanupOutcome {
  deletedEvents: number;
  deletedTrips: number;
  deletedSummaries: number;
  deletedSightings: number;
  deletedClosures: number;
  /** The first failure among the deletes, or null when all succeeded. */
  firstError: string | null;
  errors: {
    events?: string;
    trips?: string;
    summaries?: string;
    sightings?: string;
    closures?: string;
  };
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
  const deletedClosures = await attemptDelete(errors, "closures", () =>
    store.deleteClosures(cutoff),
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
    deletedClosures,
    firstError:
      errors.events ??
      errors.trips ??
      errors.summaries ??
      errors.sightings ??
      errors.closures ??
      null,
    errors,
    storage: { usedMB, dataMB, indexMB, objects, limitMB },
    storageWarning: usedMB > limitMB * 0.8,
  };
}
