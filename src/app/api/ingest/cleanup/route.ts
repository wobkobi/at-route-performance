// src/app/api/ingest/cleanup/route.ts
/**
 * @description Cron-only POST that permanently deletes ArrivalEvents and
 * TripDelays older than the retention window (default 14 days) to stay under the
 * cluster's storage allowance. Must run after the daily aggregation, since deletion is
 * irreversible. The cutoff snaps to the NZ service-day start (5am Auckland) so
 * late-night runs are not dropped against the wrong calendar boundary, retention
 * below 7 days is refused without ?force=1 to guard against an accidental purge,
 * and each collection deletes independently so one failure never skips the rest.
 * Responds 202 before the deletes run: a full day's delete takes ~40s on the
 * shared tier, past the external scheduler's 30s request timeout; the outcome is
 * recorded in IngestRun and the function logs.
 */
import { requireCronAuth } from "@/lib/auth";
import { prisma, runCommand } from "@/lib/db";
import { recordIngestRun } from "@/lib/ingest-run";
import { nzServiceDayRange } from "@/lib/time";
import { after, NextResponse } from "next/server";

/**
 * Run the retention deletes and record the outcome. Invoked via `after` so the
 * 202 response is sent first; success/failure lands in IngestRun, not the HTTP
 * response.
 * @param startTime - Epoch ms when the request arrived.
 * @param cutoffDate - Delete rows scheduled before this instant.
 * @param retentionDays - Retention window, for the logs.
 * @param summaryDays - Optional DailyRouteSummary retention in days.
 */
async function runCleanup(
  startTime: number,
  cutoffDate: Date,
  retentionDays: number,
  summaryDays: number | null,
): Promise<void> {
  try {
    console.log("[CLEANUP] Starting cleanup", {
      retentionDays,
      cutoffDate: cutoffDate.toISOString(),
      olderThanDate: cutoffDate.toISOString().split("T")[0],
    });

    // Count before deletion (for logging)
    const eventsToDelete = await prisma.arrivalEvent.count({
      where: { scheduledAt: { lt: cutoffDate } },
    });

    const tripsToDelete = await prisma.tripDelay.count({
      where: { timestamp: { lt: cutoffDate } },
    });

    console.log("[CLEANUP] Found records to delete", {
      events: eventsToDelete,
      trips: tripsToDelete,
    });

    // Delete independently: ArrivalEvent uses scheduledAt, TripDelay uses timestamp.
    // Each gets its own try/catch so a failure on one never skips the other.
    let deletedEvents = 0;
    let eventsError: string | null = null;
    try {
      const r = await prisma.arrivalEvent.deleteMany({
        where: { scheduledAt: { lt: cutoffDate } },
      });
      deletedEvents = r.count;
      console.log("[CLEANUP] Deleted ArrivalEvents", { count: deletedEvents });
    } catch (err) {
      eventsError = err instanceof Error ? err.message : "Unknown error";
      console.error("[CLEANUP] ArrivalEvent delete failed", { error: eventsError });
    }

    let deletedTrips = 0;
    let tripsError: string | null = null;
    try {
      const r = await prisma.tripDelay.deleteMany({
        where: { timestamp: { lt: cutoffDate } },
      });
      deletedTrips = r.count;
      console.log("[CLEANUP] Deleted TripDelays", { count: deletedTrips });
    } catch (err) {
      tripsError = err instanceof Error ? err.message : "Unknown error";
      console.error("[CLEANUP] TripDelay delete failed", { error: tripsError });
    }

    let deletedSummaries = 0;
    let summariesError: string | null = null;
    if (summaryDays !== null) {
      try {
        const { start: summaryCutoff } = nzServiceDayRange(
          new Date(Date.now() - summaryDays * 86_400_000),
        );
        const r = await prisma.dailyRouteSummary.deleteMany({
          where: { date: { lt: summaryCutoff } },
        });
        deletedSummaries = r.count;
        console.log("[CLEANUP] Deleted DailyRouteSummaries", {
          count: deletedSummaries,
          olderThan: summaryCutoff.toISOString(),
        });
      } catch (err) {
        summariesError = err instanceof Error ? err.message : "Unknown error";
        console.error("[CLEANUP] DailyRouteSummary delete failed", { error: summariesError });
      }
    }

    const duration = Date.now() - startTime;

    console.log("[CLEANUP] Complete", {
      timestamp: new Date().toISOString(),
      deletedEvents,
      deletedTrips,
      deletedSummaries,
      olderThan: cutoffDate.toISOString(),
      retentionDays,
      duration_ms: duration,
      ...(eventsError ? { eventsError } : {}),
      ...(tripsError ? { tripsError } : {}),
      ...(summariesError ? { summariesError } : {}),
    });

    // Warn when nearing the cluster storage allowance, using real on-disk
    // sizes from dbStats (compressed data + indexes) - a per-event byte
    // estimate overstated usage by ~2x. Override the allowance with
    // STORAGE_LIMIT_MB when the cluster tier changes.
    const limitMB = parseInt(process.env.STORAGE_LIMIT_MB || "512", 10);
    const stats = (await runCommand(() => prisma.$runCommandRaw({ dbStats: 1 }))) as {
      storageSize?: number;
      indexSize?: number;
      objects?: number;
    };
    const dataMB = Number(stats.storageSize ?? 0) / 1_048_576;
    const indexMB = Number(stats.indexSize ?? 0) / 1_048_576;
    const usedMB = dataMB + indexMB;

    if (usedMB > limitMB * 0.8) {
      console.warn("[CLEANUP] ⚠️  Storage warning", {
        usedMB: usedMB.toFixed(0),
        dataMB: dataMB.toFixed(0),
        indexMB: indexMB.toFixed(0),
        limitMB,
        objects: Number(stats.objects ?? 0),
        message: "Nearing the cluster storage allowance. Consider reducing retention.",
      });
    }

    const partialFailure = eventsError ?? tripsError ?? summariesError ?? null;
    await recordIngestRun({
      endpoint: "cleanup",
      startedAt: new Date(startTime),
      success: !partialFailure,
      count: deletedEvents + deletedTrips + deletedSummaries,
      ...(partialFailure ? { error: partialFailure } : {}),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[CLEANUP] Failed", {
      timestamp: new Date().toISOString(),
      error: msg,
      duration_ms: Date.now() - startTime,
    });
    await recordIngestRun({
      endpoint: "cleanup",
      startedAt: new Date(startTime),
      success: false,
      error: msg,
    });
  }
}

/**
 * Delete ArrivalEvents and TripDelays older than retentionDays (default 14).
 * Deletes data permanently - must run AFTER the daily aggregation. Validates
 * the params, acknowledges, then runs the deletes after the response.
 * @param req - Request with optional `?retentionDays=N` and `?force=1` params.
 * @returns 202 JSON `{ started, retentionDays, olderThan }`; 400/401 on bad input.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const startTime = Date.now();

  const denied = requireCronAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);

  // Parse retention period (default to env var, then 14 days)
  const retentionParam = url.searchParams.get("retentionDays");
  const retentionDays = retentionParam
    ? parseInt(retentionParam, 10)
    : parseInt(process.env.RETENTION_DAYS || "14", 10);

  // Optional: prune DailyRouteSummary records older than N days.
  const summaryDaysParam = url.searchParams.get("summaryDays");
  const summaryDays = summaryDaysParam ? parseInt(summaryDaysParam, 10) : null;

  if (isNaN(retentionDays) || retentionDays < 1) {
    return NextResponse.json({ error: "Invalid retentionDays. Must be >= 1" }, { status: 400 });
  }
  if (summaryDays !== null && (isNaN(summaryDays) || summaryDays < 1)) {
    return NextResponse.json({ error: "Invalid summaryDays. Must be >= 1" }, { status: 400 });
  }

  // Safety check: don't allow retention < 7 days unless explicitly forced
  if (retentionDays < 7 && !url.searchParams.has("force")) {
    return NextResponse.json(
      {
        error: "Retention < 7 days requires ?force=1 parameter",
        hint: "This prevents accidental aggressive deletion",
      },
      { status: 400 },
    );
  }

  // Cutoff at the NZ service-day START (5am NZ local) for the day that was
  // retentionDays Auckland calendar days ago. Using UTC midnight would snap
  // to the wrong boundary and silently drop late-night runs (11pm-1am) that
  // belong to the service day before the cutoff.
  const { start: cutoffDate } = nzServiceDayRange(
    new Date(Date.now() - retentionDays * 86_400_000),
  );

  after(() => runCleanup(startTime, cutoffDate, retentionDays, summaryDays));

  return NextResponse.json(
    { started: true, retentionDays, olderThan: cutoffDate.toISOString() },
    { status: 202 },
  );
}
