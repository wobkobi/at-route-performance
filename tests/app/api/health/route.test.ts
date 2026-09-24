// tests/app/api/health/route.test.ts
// Handler test for GET /api/health: the deployed version, the cleanup window,
// the rule that a database outage answers `database: "down"` while `ok` stays
// true - the build being up and the database being reachable are separate
// questions - and that the probe is a real collection read, because a ping
// answers while the read path behind it is degraded.
import { GET } from "@/app/api/health/route";
import { recentCleanupRuns, type RecordedCleanupRun } from "@/lib/cleanup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../../../package.json";

/** The collection read the probe sends. Hoisted so the module mock closes over it. */
const findFirst = vi.hoisted(() => vi.fn<() => Promise<unknown>>());

vi.mock("@/lib/cleanup", () => ({ recentCleanupRuns: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { route: { findFirst } } }));

/** The probe's JSON body. */
interface HealthBody {
  ok: boolean;
  version: string;
  time: string;
  database: "up" | "down";
  databaseMs: number;
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
    findFirst.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the package version, the cleanup window and forbids caching", async () => {
    findFirst.mockResolvedValue({ id: "NX1" });
    vi.mocked(recentCleanupRuns).mockResolvedValue([recorded]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as HealthBody;
    expect(body.ok).toBe(true);
    expect(body.version).toBe(pkg.version);
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
    expect(body.database).toBe("up");
    expect(body.databaseMs).toBeGreaterThanOrEqual(0);
    expect(body.cleanup).toMatchObject({ retentionDays: 3652, dryRun: true });
  });

  it("probes with a collection read rather than a ping", async () => {
    // A ping is answered by the server while the query path behind it queues, so
    // swapping this back for one would report a degraded read path as healthy.
    findFirst.mockResolvedValue({ id: "NX1" });
    vi.mocked(recentCleanupRuns).mockResolvedValue([recorded]);
    await GET();
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
  });

  it("calls an empty collection up, because the read still answered", async () => {
    findFirst.mockResolvedValue(null);
    vi.mocked(recentCleanupRuns).mockResolvedValue([recorded]);
    const res = await GET();
    const body = (await res.json()) as HealthBody;
    expect(body.database).toBe("up");
  });

  it("still answers ok when the cleanup read fails, with a null window", async () => {
    findFirst.mockResolvedValue({ id: "NX1" });
    vi.mocked(recentCleanupRuns).mockRejectedValue(new Error("no database"));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthBody;
    expect(body.ok).toBe(true);
    expect(body.database).toBe("up");
    expect(body.cleanup).toBeNull();
  });

  it("calls an unreachable database down without asking it for the window", async () => {
    findFirst.mockRejectedValue(new Error("Can't reach database server at `nas.local:27019`"));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthBody;
    // `ok` stays true: the build is serving, which is what the deploy check asks.
    expect(body.ok).toBe(true);
    expect(body.database).toBe("down");
    expect(body.databaseMs).toBeGreaterThanOrEqual(0);
    expect(body.cleanup).toBeNull();
    expect(recentCleanupRuns).not.toHaveBeenCalled();
  });

  it("calls a read that never answers down on the five-second bound", async () => {
    // The whole point of the bound: an unreachable server otherwise holds the
    // request for the driver's ~30s server-selection timeout, and a monitor
    // records a hung probe rather than a down database.
    vi.useFakeTimers();
    findFirst.mockReturnValue(new Promise<never>(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(5_000);
    const res = await pending;
    const body = (await res.json()) as HealthBody;
    expect(body.database).toBe("down");
    expect(recentCleanupRuns).not.toHaveBeenCalled();
  });
});
