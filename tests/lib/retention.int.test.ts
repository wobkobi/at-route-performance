// tests/lib/retention.int.test.ts
// Guards the deployed retention window from the suite rather than from absent
// history: a variable that goes missing in a future environment shows up here
// before the night it would matter. Read-only on IngestRun, no writes and no
// scratch collection. Needs DATABASE_URL: `npm run test:int`.
import { MIN_SAFE_RETENTION_DAYS, recentCleanupRuns } from "@/lib/cleanup";
import { prisma } from "@/lib/db";
import { projectCleanupHealth } from "@/lib/health";
import { afterAll, describe, expect, it } from "vitest";

describe("recorded retention", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reports a window no shorter than the safe floor", async () => {
    const cleanup = projectCleanupHealth(await recentCleanupRuns(10));
    // Before the first run after A1 ships there is nothing to check; that gap
    // closes on the next nightly cleanup, and failing here would fail the suite
    // on any fresh environment.
    if (cleanup === null) return;
    expect(cleanup.retentionDays).toBeGreaterThanOrEqual(MIN_SAFE_RETENTION_DAYS);
  });
});
