// src/lib/health.ts
// The cleanup window as GET /api/health reports it: a pure projection over the
// recorded runs, so the endpoint's handler stays a one-liner and the shape is
// testable without a database.
import type { RecordedCleanupRun } from "@/lib/cleanup";

/** The cleanup window as the health probe reports it. */
export interface HealthCleanup {
  retentionDays: number;
  /** ISO cutoff the run used. */
  cutoff: string;
  /** ISO instant the run finished. */
  ranAt: string;
  applied: boolean;
  dryRun: boolean;
  /** Why a guard refused, or null. */
  refused: string | null;
}

/**
 * The newest cleanup run's window. Takes the newest run that recorded a detail
 * at all, applied or not: a refusal is exactly what an operator needs to see
 * here, and skipping past it would report the last run that went through as
 * though it were last night's.
 * @param runs - Recent cleanup runs, newest first.
 * @returns The window, or null when no run has recorded one.
 */
export function projectCleanupHealth(runs: readonly RecordedCleanupRun[]): HealthCleanup | null {
  const run = runs.find((r) => r.detail !== null);
  if (!run?.detail) return null;
  return {
    retentionDays: run.detail.retentionDays,
    cutoff: run.detail.cutoff,
    ranAt: run.completedAt.toISOString(),
    applied: run.detail.applied,
    dryRun: run.detail.dryRun,
    refused: run.detail.refused,
  };
}
