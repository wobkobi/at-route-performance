// tests/lib/data/ghost-runs.test.ts
// The shaping the trip page's two ghost panels read: the clock labels derived
// from the trip ids, the named run when the sibling test found one, and which
// day each lookup is scoped to.
import { getGhostRun, getGhostRunFor } from "@/lib/data/ghost-runs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { ghostRun: { findFirst } } }));
// The lookup's shaping is what is under test, not the Data Cache wrapper.
vi.mock("@/lib/mem-cache", () => ({
  /**
   * Pass the factory straight through.
   * @param fn - The cached factory.
   * @returns The factory itself.
   */
  unstable_cache: (fn: () => unknown) => fn,
}));

/** The one whole-ghost run in the data, as C2 records it. */
const STORED = {
  tripId: "1155-71203-58560-2-528ac570",
  routeId: "712-221",
  serviceDate: "2026-09-14",
  levelSec: -5792,
  readings: 3,
  vehicleId: "26207",
  belongsToTripId: null,
  evidence: ["anchor"],
};

beforeEach(() => {
  findFirst.mockReset();
});

describe("getGhostRun", () => {
  it("labels the run from its own trip id and names no other run", async () => {
    findFirst.mockResolvedValue(STORED);
    const row = await getGhostRun(STORED.tripId, "2026-09-14");
    // Start seconds 58560 is 16:16 on the run's own service day.
    expect(row?.label).toMatch(/4:16/);
    expect(row).toMatchObject({
      trip_id: STORED.tripId,
      route_id: "712-221",
      service_date: "2026-09-14",
      level_sec: -5792,
      readings: 3,
      vehicle_id: "26207",
      belongs_to: null,
      evidence: ["anchor"],
    });
  });

  it("names and labels the run the readings belong to", async () => {
    findFirst.mockResolvedValue({
      ...STORED,
      belongsToTripId: "1155-71203-62160-2-528ac570",
      evidence: ["anchor", "silent-sibling"],
    });
    const row = await getGhostRun(STORED.tripId, "2026-09-14");
    expect(row?.belongs_to?.trip_id).toBe("1155-71203-62160-2-528ac570");
    // 62160 s is 17:16, the slot an hour after the one it was filed under.
    expect(row?.belongs_to?.label).toMatch(/5:16/);
  });

  it("scopes to the run's own day, and takes the latest without one", async () => {
    findFirst.mockResolvedValue(STORED);
    await getGhostRun(STORED.tripId, "2026-09-14");
    expect(findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { tripId: STORED.tripId, serviceDate: "2026-09-14" },
    });

    findFirst.mockClear();
    await getGhostRun(STORED.tripId, null);
    const arg = findFirst.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(arg.where).toEqual({ tripId: STORED.tripId });
    expect(arg).toMatchObject({ orderBy: { serviceDate: "desc" } });
  });

  it("gives back nothing for a run that was never hidden", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getGhostRun("1108-15203-78300-2-58ac9d51", "2026-09-14")).toBeNull();
  });

  it("leaves the label null when the trip id encodes no start", async () => {
    findFirst.mockResolvedValue({ ...STORED, tripId: "no-start-here" });
    expect((await getGhostRun("no-start-here", "2026-09-14"))?.label).toBeNull();
  });
});

describe("getGhostRunFor", () => {
  it("looks a run up by the trip its readings were taken from", async () => {
    findFirst.mockResolvedValue({
      ...STORED,
      belongsToTripId: "1155-71203-62160-2-528ac570",
      evidence: ["anchor", "silent-sibling"],
    });
    const row = await getGhostRunFor("1155-71203-62160-2-528ac570", "2026-09-14");
    expect(findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { belongsToTripId: "1155-71203-62160-2-528ac570", serviceDate: "2026-09-14" },
    });
    // The mirror panel names the run the readings were filed UNDER, which is
    // this row's own trip id.
    expect(row?.label).toMatch(/4:16/);
  });
});
