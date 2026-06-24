// src/app/api/ingest/cleanup/route.ts
import { requireCronAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordIngestRun } from "@/lib/ingest-run";
import { nzServiceDayRange } from "@/lib/time";
import { NextResponse } from "next/server";

/**
 * Delete ArrivalEvents and TripDelays older than retentionDays (default 14).
 * Deletes data permanently - must run AFTER the daily aggregation.
 * @param req - Request with optional `?retentionDays=N` and `?force=1` params.
 * @returns JSON `{ deletedEvents, deletedTrips, olderThan, retentionDays, duration_ms }`.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const startTime = Date.now();

  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
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

    const result = {
      deletedEvents,
      deletedTrips,
      deletedSummaries,
      olderThan: cutoffDate.toISOString(),
      retentionDays,
      duration_ms: duration,
      ...(eventsError ? { eventsError } : {}),
      ...(tripsError ? { tripsError } : {}),
      ...(summariesError ? { summariesError } : {}),
    };

    console.log("[CLEANUP] Complete", {
      timestamp: new Date().toISOString(),
      ...result,
    });

    // Warning if we're approaching storage limits (heuristic)
    const remainingEvents = await prisma.arrivalEvent.count();
    const estimatedMB = (remainingEvents * 250) / 1_000_000; // 250 bytes/event

    if (estimatedMB > 400) {
      console.warn("[CLEANUP] ⚠️  Storage warning", {
        remainingEvents,
        estimatedMB: estimatedMB.toFixed(0),
        limitMB: 512,
        message: "Approaching Atlas M0 storage limit. Consider reducing retention.",
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

    return NextResponse.json(result, { status: partialFailure ? 500 : 200 });
  } catch (error) {
    const duration = Date.now() - startTime;
    const msg = error instanceof Error ? error.message : "Unknown error";

    console.error("[CLEANUP] Failed", {
      timestamp: new Date().toISOString(),
      error: msg,
      duration_ms: duration,
    });

    await recordIngestRun({
      endpoint: "cleanup",
      startedAt: new Date(startTime),
      success: false,
      error: msg,
    });

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
