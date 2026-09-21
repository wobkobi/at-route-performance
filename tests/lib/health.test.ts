// tests/lib/health.test.ts
// Unit tests for the health endpoint's cleanup projection. No Prisma mock: the
// only import from cleanup is type-only, so the module graph never reaches the
// client.
import type { CleanupRunDetail, RecordedCleanupRun } from "@/lib/cleanup";
import { projectCleanupHealth } from "@/lib/health";
import { describe, expect, it } from "vitest";

/**
 * A recorded cleanup run carrying the full detail shape.
 * @param ranAt - When the run finished.
 * @param over - Fields to override on the detail.
 * @returns The record.
 */
function run(ranAt: string, over: Partial<CleanupRunDetail> = {}): RecordedCleanupRun {
  return {
    completedAt: new Date(ranAt),
    success: true,
    detail: {
      retentionDays: 3652,
      summaryDays: null,
      cutoff: "2016-10-05T16:00:00.000Z",
      doomedEvents: 0,
      doomedTrips: 0,
      totalEvents: 3_350_000,
      share: 0,
      lastAppliedCutoff: null,
      forced: false,
      applied: true,
      dryRun: false,
      refused: null,
      ...over,
    },
  };
}

describe("projectCleanupHealth", () => {
  it("reports the newest run that recorded a window", () => {
    expect(
      projectCleanupHealth([
        run("2026-09-26T15:02:00.000Z"),
        run("2026-09-25T15:02:00.000Z", { retentionDays: 14 }),
      ]),
    ).toEqual({
      retentionDays: 3652,
      cutoff: "2016-10-05T16:00:00.000Z",
      ranAt: "2026-09-26T15:02:00.000Z",
      applied: true,
      dryRun: false,
      refused: null,
    });
  });

  it("shows a refusal rather than skipping past it", () => {
    const refused = projectCleanupHealth([
      run("2026-09-26T15:02:00.000Z", { applied: false, refused: "over the 2% ceiling" }),
      run("2026-09-25T15:02:00.000Z"),
    ]);
    expect(refused?.applied).toBe(false);
    expect(refused?.refused).toBe("over the 2% ceiling");
  });

  it("is null when no run has a detail yet", () => {
    expect(projectCleanupHealth([])).toBeNull();
    expect(
      projectCleanupHealth([{ completedAt: new Date(), success: true, detail: null }]),
    ).toBeNull();
  });
});
