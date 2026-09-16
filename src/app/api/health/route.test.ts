// src/app/api/health/route.test.ts
// Handler test for GET /api/health: the deployed version, the cleanup window,
// and the rule that a database outage leaves the window null rather than
// failing the probe.
import { GET } from "@/app/api/health/route";
import { recentCleanupRuns, type RecordedCleanupRun } from "@/lib/cleanup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../../../package.json";

vi.mock("@/lib/cleanup", () => ({ recentCleanupRuns: vi.fn() }));

/** The probe's JSON body. */
interface HealthBody {
  ok: boolean;
  version: string;
  time: string;
  cleanup: { retentionDays: number; dryRun: boolean } | null;
}

const recorded: RecordedCleanupRun = {
  completedAt: new Date("2026-09-26T15:02:00.000Z"),
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
    applied: false,
    dryRun: true,
    refused: null,
  },
};

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.mocked(recentCleanupRuns).mockReset();
  });

  it("reports the package version, the cleanup window and forbids caching", async () => {
    vi.mocked(recentCleanupRuns).mockResolvedValue([recorded]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as HealthBody;
    expect(body.ok).toBe(true);
    expect(body.version).toBe(pkg.version);
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
    expect(body.cleanup).toMatchObject({ retentionDays: 3652, dryRun: true });
  });

  it("still answers ok when the database read fails, with a null window", async () => {
    vi.mocked(recentCleanupRuns).mockRejectedValue(new Error("no database"));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthBody;
    expect(body.ok).toBe(true);
    expect(body.cleanup).toBeNull();
  });
});
