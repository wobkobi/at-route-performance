// src/app/api/ingest/cleanup/route.ts
// Cron-only POST that permanently deletes ArrivalEvents, TripDelays and
// off-route sightings older than the retention window (see lib/cleanup.ts).
// Must run after the daily aggregation, since deletion is irreversible.
//
// Refusals split by whether they need the database. A missing RETENTION_DAYS or
// a retention under the floor answers 400 and records nothing. The share and
// cutoff-advance guards need counts, and the request is already acknowledged
// with 202 by then - a full day's delete can outrun the external scheduler's
// 30s timeout - so those refusals land on IngestRun with success: false, which
// is the only field anything alerts on.

import { requireCronAuth } from "@/lib/auth";
import {
  buildCleanupPlan,
  checkCleanupPlan,
  cleanupCutoff,
  DEFAULT_STORAGE_LIMIT_MB,
  parseCleanupParams,
  pickLastAppliedCutoff,
  prismaCleanupStore,
  recentCleanupRuns,
  runCleanup,
  type CleanupParams,
  type CleanupRunDetail,
} from "@/lib/cleanup";
import { recordIngestRun } from "@/lib/ingest-run";
import { after, NextResponse } from "next/server";

/**
 * How many recent cleanup runs to read when looking for the last applied
 * cutoff. Deep enough to see past a run of dry runs and refusals, shallow
 * enough to stay a single indexed lookup.
 */
const RUN_LOOKBACK = 20;

/**
 * Plan the retention deletes, run them unless a guard or `?dryRun=1` says
 * otherwise, and record the whole decision. Invoked via `after` so the 202 is
 * sent first; success, refusal and failure all land in IngestRun, not the HTTP
 * response.
 * @param startTime - Epoch ms when the request arrived.
 * @param params - The validated request.
 * @param now - The instant the request arrived, so the cutoff cannot drift.
 */
async function runAndRecord(startTime: number, params: CleanupParams, now: Date): Promise<void> {
  const startedAt = new Date(startTime);
  try {
    const cutoff = cleanupCutoff(params.retentionDays, now);
    const [doomedEvents, totalEvents, doomedTrips] = await Promise.all([
      prismaCleanupStore.countEvents(cutoff),
      prismaCleanupStore.countAllEvents(),
      prismaCleanupStore.countTrips(cutoff),
    ]);
    const plan = buildCleanupPlan(params, { doomedEvents, totalEvents }, now);
    const lastCutoff = pickLastAppliedCutoff(await recentCleanupRuns(RUN_LOOKBACK));
    const verdict = checkCleanupPlan(plan, lastCutoff, params.force);

    // The shape every outcome records, so a run's retention and cutoff can be
    // read back from the database whatever it decided to do.
    const record = {
      retentionDays: plan.retentionDays,
      summaryDays: plan.summaryDays,
      cutoff: plan.cutoff.toISOString(),
      doomedEvents,
      doomedTrips,
      totalEvents,
      share: Number(plan.share.toFixed(6)),
      lastAppliedCutoff: lastCutoff?.toISOString() ?? null,
      forced: params.force,
      dryRun: params.dryRun,
      applied: false,
      refused: null,
    } satisfies CleanupRunDetail;
    console.log("[CLEANUP] plan", {
      ...record,
      verdict: verdict.ok ? "ok" : verdict.reason,
    });

    if (!verdict.ok) {
      console.error("[CLEANUP] Refused", { reason: verdict.reason, message: verdict.message });
      await recordIngestRun({
        endpoint: "cleanup",
        startedAt,
        success: false,
        count: 0,
        error: verdict.message,
        detail: { ...record, refused: verdict.message },
      });
      return;
    }

    if (params.dryRun) {
      console.log("[CLEANUP] Dry run, nothing deleted", record);
      await recordIngestRun({
        endpoint: "cleanup",
        startedAt,
        success: true,
        count: 0,
        detail: { ...record },
      });
      return;
    }

    const limitMB = parseInt(process.env.STORAGE_LIMIT_MB || String(DEFAULT_STORAGE_LIMIT_MB), 10);
    const outcome = await runCleanup(prismaCleanupStore, cutoff, params.summaryDays, limitMB, now);
    const deleted = {
      events: outcome.deletedEvents,
      trips: outcome.deletedTrips,
      summaries: outcome.deletedSummaries,
      sightings: outcome.deletedSightings,
      closures: outcome.deletedClosures,
    };

    console.log("[CLEANUP] Complete", {
      ...deleted,
      olderThan: cutoff.toISOString(),
      retentionDays: plan.retentionDays,
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
      startedAt,
      success: outcome.firstError === null,
      count: deleted.events + deleted.trips + deleted.summaries + deleted.sightings,
      ...(outcome.firstError ? { error: outcome.firstError } : {}),
      detail: {
        ...record,
        // "Applied" means the deletes ran - not a dry run, not refused -
        // whatever the row count. A correct run at a ten-year window deletes
        // nothing for a decade, and a cutoff no run ever claims is a baseline
        // the advance guard can never measure against.
        applied: true,
        deleted,
        storage: {
          usedMB: Number(outcome.storage.usedMB.toFixed(1)),
          limitMB: outcome.storage.limitMB,
        },
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[CLEANUP] Failed", { error: msg, duration_ms: Date.now() - startTime });
    await recordIngestRun({ endpoint: "cleanup", startedAt, success: false, error: msg });
  }
}

/**
 * Delete ArrivalEvents, TripDelays and off-route sightings older than the
 * retention window. Deletes data permanently - must run AFTER the daily
 * aggregation. Validates what it can without a query, acknowledges, then plans
 * and runs the deletes after the response.
 * @param req - Request with optional `?retentionDays=N`, `?summaryDays=N`, `?force=1` and `?dryRun=1` params.
 * @returns 202 JSON `{ started, dryRun, retentionDays, olderThan }`; 400/401 on bad input.
 */
export function POST(req: Request): NextResponse {
  const startTime = Date.now();

  const denied = requireCronAuth(req);
  if (denied) return denied;

  const parsed = parseCleanupParams(new URL(req.url), process.env.RETENTION_DAYS);
  if (!parsed.ok) return NextResponse.json(parsed.refusal, { status: 400 });
  const { params } = parsed;

  const now = new Date(startTime);
  after(() => runAndRecord(startTime, params, now));

  return NextResponse.json(
    {
      started: true,
      dryRun: params.dryRun,
      retentionDays: params.retentionDays,
      olderThan: cleanupCutoff(params.retentionDays, now).toISOString(),
    },
    { status: 202 },
  );
}
