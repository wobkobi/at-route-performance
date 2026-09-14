// src/app/api/ingest/cleanup/route.ts
// Cron-only POST that permanently deletes ArrivalEvents, TripDelays and off-route sightings older
// than the retention window (default 14 days) to stay under the storage
// allowance (see lib/cleanup.ts). Must run after the daily aggregation, since
// deletion is irreversible. Responds 202 before the deletes run: a full day's
// delete can run past the external scheduler's 30s request timeout; the
// outcome is recorded in IngestRun and the function logs.

import { requireCronAuth } from "@/lib/auth";
import {
  cleanupCutoff,
  DEFAULT_STORAGE_LIMIT_MB,
  parseCleanupParams,
  prismaCleanupStore,
  runCleanup,
} from "@/lib/cleanup";
import { recordIngestRun } from "@/lib/ingest-run";
import { after, NextResponse } from "next/server";

/**
 * Run the retention deletes and record the outcome. Invoked via `after` so the
 * 202 response is sent first; success or failure lands in IngestRun, not the
 * HTTP response.
 * @param startTime - Epoch ms when the request arrived.
 * @param cutoffDate - Delete rows scheduled before this instant.
 * @param retentionDays - Retention window, for the logs.
 * @param summaryDays - Optional DailyRouteSummary retention in days.
 */
async function runAndRecord(
  startTime: number,
  cutoffDate: Date,
  retentionDays: number,
  summaryDays: number | null,
): Promise<void> {
  try {
    console.log("[CLEANUP] Starting cleanup", {
      retentionDays,
      cutoffDate: cutoffDate.toISOString(),
    });
    const [events, trips] = await Promise.all([
      prismaCleanupStore.countEvents(cutoffDate),
      prismaCleanupStore.countTrips(cutoffDate),
    ]);
    console.log("[CLEANUP] Found records to delete", { events, trips });

    const limitMB = parseInt(process.env.STORAGE_LIMIT_MB || String(DEFAULT_STORAGE_LIMIT_MB), 10);
    const outcome = await runCleanup(prismaCleanupStore, cutoffDate, summaryDays, limitMB);

    console.log("[CLEANUP] Complete", {
      deletedEvents: outcome.deletedEvents,
      deletedTrips: outcome.deletedTrips,
      deletedSummaries: outcome.deletedSummaries,
      deletedSightings: outcome.deletedSightings,
      olderThan: cutoffDate.toISOString(),
      retentionDays,
      duration_ms: Date.now() - startTime,
      ...outcome.errors,
    });
    if (outcome.storageWarning) {
      const { usedMB, dataMB, indexMB, objects } = outcome.storage;
      console.warn("[CLEANUP] Storage warning", {
        usedMB: usedMB.toFixed(0),
        dataMB: dataMB.toFixed(0),
        indexMB: indexMB.toFixed(0),
        limitMB,
        objects,
        message: "Nearing the storage allowance. Consider reducing retention.",
      });
    }

    await recordIngestRun({
      endpoint: "cleanup",
      startedAt: new Date(startTime),
      success: outcome.firstError === null,
      count:
        outcome.deletedEvents +
        outcome.deletedTrips +
        outcome.deletedSummaries +
        outcome.deletedSightings,
      ...(outcome.firstError ? { error: outcome.firstError } : {}),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[CLEANUP] Failed", { error: msg, duration_ms: Date.now() - startTime });
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
 * @param req - Request with optional `?retentionDays=N`, `?summaryDays=N` and `?force=1` params.
 * @returns 202 JSON `{ started, retentionDays, olderThan }`; 400/401 on bad input.
 */
export function POST(req: Request): NextResponse {
  const startTime = Date.now();

  const denied = requireCronAuth(req);
  if (denied) return denied;

  const parsed = parseCleanupParams(new URL(req.url), process.env.RETENTION_DAYS);
  if (!parsed.ok) return NextResponse.json(parsed.refusal, { status: 400 });
  const { retentionDays, summaryDays } = parsed.params;

  const cutoffDate = cleanupCutoff(retentionDays);
  after(() => runAndRecord(startTime, cutoffDate, retentionDays, summaryDays));

  return NextResponse.json(
    { started: true, retentionDays, olderThan: cutoffDate.toISOString() },
    { status: 202 },
  );
}
