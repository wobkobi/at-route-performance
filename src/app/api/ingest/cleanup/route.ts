// src/app/api/ingest/cleanup/route.ts
import { requireCronAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
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
    // Parse retention period (default to env var, then 14 days)
    const url = new URL(req.url);
    const retentionParam = url.searchParams.get("retentionDays");
    const retentionDays = retentionParam
      ? parseInt(retentionParam, 10)
      : parseInt(process.env.RETENTION_DAYS || "14", 10);

    if (isNaN(retentionDays) || retentionDays < 1) {
      return NextResponse.json({ error: "Invalid retentionDays. Must be >= 1" }, { status: 400 });
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

    // Calculate cutoff date (UTC midnight, so retention is server-tz independent)
    const cutoffDate = new Date();
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - retentionDays);
    cutoffDate.setUTCHours(0, 0, 0, 0);

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

    // Delete ArrivalEvents
    const deletedEvents = await prisma.arrivalEvent.deleteMany({
      where: { scheduledAt: { lt: cutoffDate } },
    });

    console.log("[CLEANUP] Deleted ArrivalEvents", {
      count: deletedEvents.count,
    });

    // Delete TripDelays
    const deletedTrips = await prisma.tripDelay.deleteMany({
      where: { timestamp: { lt: cutoffDate } },
    });

    console.log("[CLEANUP] Deleted TripDelays", {
      count: deletedTrips.count,
    });

    const duration = Date.now() - startTime;

    const result = {
      deletedEvents: deletedEvents.count,
      deletedTrips: deletedTrips.count,
      olderThan: cutoffDate.toISOString(),
      retentionDays,
      duration_ms: duration,
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

    return NextResponse.json(result);
  } catch (error) {
    const duration = Date.now() - startTime;
    const msg = error instanceof Error ? error.message : "Unknown error";

    console.error("[CLEANUP] Failed", {
      timestamp: new Date().toISOString(),
      error: msg,
      duration_ms: duration,
    });

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
