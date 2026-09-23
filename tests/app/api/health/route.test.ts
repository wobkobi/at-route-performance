// tests/app/api/health/route.test.ts
// Handler test for GET /api/health: the deployed version, the cleanup window,
// and the rule that a database outage answers `database: "down"` while `ok`
// stays true, because the build being up and the database being reachable are
// separate questions.
import { GET } from "@/app/api/health/route";
import { recentCleanupRuns, type RecordedCleanupRun } from "@/lib/cleanup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../../../package.json";

/** The ping the probe sends. Hoisted so the module mock can close over it. */
const ping = vi.hoisted(() => vi.fn<() => Promise<unknown>>());

vi.mock("@/lib/cleanup", () => ({ recentCleanupRuns: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $runCommandRaw: ping } }));

/** The probe's JSON body. */
interface HealthBody {
  ok: boolean;
  version: string;
  time: string;
  database: "up" | "down";
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
    ping.mockReset();
  });

  it("reports the package version, the cleanup window and forbids caching", async () => {
    ping.mockResolvedValue({ ok: 1 });
    vi.mocked(recentCleanupRuns).mockResolvedValue([recorded]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as HealthBody;
    expect(body.ok).toBe(true);
    expect(body.version).toBe(pkg.version);
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
    expect(body.database).toBe("up");
    expect(body.cleanup).toMatchObject({ retentionDays: 3652, dryRun: true });
  });

  it("still answers ok when the database read fails, with a null window", async () => {
    ping.mockResolvedValue({ ok: 1 });
    vi.mocked(recentCleanupRuns).mockRejectedValue(new Error("no database"));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthBody;
    expect(body.ok).toBe(true);
    expect(body.database).toBe("up");
    expect(body.cleanup).toBeNull();
  });

  it("calls an unreachable database down without asking it for the window", async () => {
    ping.mockRejectedValue(new Error("Can't reach database server at `nas.local:27019`"));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthBody;
    // `ok` stays true: the build is serving, which is what the deploy check asks.
    expect(body.ok).toBe(true);
    expect(body.database).toBe("down");
    expect(body.cleanup).toBeNull();
    expect(recentCleanupRuns).not.toHaveBeenCalled();
  });
});
