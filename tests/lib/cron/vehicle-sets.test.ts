// tests/lib/cron/vehicle-sets.test.ts
// Tests the nightly vehicle sets: the hour bits, the day's read, the stored rows and the
// order the writer lands them in.
import {
  hourMask,
  hourRangeMask,
  staleVehicleSetDelete,
  VEHICLE_SET_INDEXES,
  vehicleSetsPipeline,
  vehicleSetUpsertOps,
  writeVehicleSets,
} from "@/lib/cron/vehicle-sets";
import { realDeviationMatchFor } from "@/lib/deviation";
import { NZ_TZ, nzServiceDayRange } from "@/lib/time/service-day";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { aggregateRows, runCommandRaw } = vi.hoisted(() => ({
  aggregateRows: vi.fn(),
  runCommandRaw: vi.fn(),
}));

vi.mock("@/lib/data/raw", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/raw")>()),
  aggregateRows,
}));
vi.mock("@/lib/db", () => ({
  prisma: { $runCommandRaw: runCommandRaw },
  /**
   * Run the command once, with no retry.
   * @param fn - The command.
   * @returns Its reply.
   */
  runCommand: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  /**
   * Accept every reply: the write errors are not under test.
   * @returns Nothing.
   */
  throwOnWriteErrors: (): undefined => undefined,
}));

const DAY = { $date: nzServiceDayRange("2026-10-02").start.toISOString() };

beforeEach(() => {
  aggregateRows.mockReset();
  runCommandRaw.mockReset();
  runCommandRaw.mockResolvedValue({ ok: 1 });
});

describe("hourMask", () => {
  it("sets bit n for clock hour n", () => {
    expect(hourMask([0])).toBe(1);
    expect(hourMask([7, 8, 9])).toBe(896);
    expect(hourMask([23])).toBe(2 ** 23);
  });

  it("is zero for no hours", () => {
    expect(hourMask([])).toBe(0);
  });
});

describe("hourRangeMask", () => {
  it("covers a range's hours, its end left out", () => {
    expect(hourRangeMask({ from: 7, to: 10 })).toBe(896);
  });

  it("wraps past midnight", () => {
    expect(hourRangeMask({ from: 22, to: 2 })).toBe(2 ** 22 + 2 ** 23 + 1 + 2);
  });
});

describe("vehicleSetsPipeline", () => {
  it("reads the day's classified, digits-only vehicles and their Auckland hours per route", () => {
    const { start, end } = nzServiceDayRange("2026-10-02");
    const [match, perVehicle, perRoute] = vehicleSetsPipeline("2026-10-02");
    // Classified: the ghost and no-delay exclusions, and no unclassified deviation bound.
    expect(match).toEqual({
      $match: {
        scheduledAt: { $gte: { $date: start.toISOString() }, $lt: { $date: end.toISOString() } },
        ...realDeviationMatchFor(true),
        vehicleId: { $regex: "^[0-9]+$" },
      },
    });
    expect(JSON.stringify(match)).not.toContain("deviationSec");
    expect(perVehicle).toEqual({
      $group: {
        _id: { r: "$routeId", v: "$vehicleId" },
        hs: { $addToSet: { $hour: { date: "$scheduledAt", timezone: NZ_TZ } } },
      },
    });
    expect(perRoute).toEqual({
      $group: { _id: "$_id.r", vs: { $push: { v: "$_id.v", hs: "$hs" } } },
    });
  });
});

describe("vehicleSetUpsertOps", () => {
  it("upserts each route's row on the exact day start", () => {
    expect(vehicleSetUpsertOps(new Map([["70-203", [{ v: "1", h: 896 }]]]), "2026-10-02")).toEqual([
      {
        q: { routeId: "70-203", date: DAY },
        u: { $set: { routeId: "70-203", date: DAY, vs: [{ v: "1", h: 896 }] } },
        upsert: true,
      },
    ]);
  });
});

describe("staleVehicleSetDelete", () => {
  it("clears the day's rows for every route the run did not see, the marker included", () => {
    const { start, end } = nzServiceDayRange("2026-10-02");
    expect(staleVehicleSetDelete(["70-203"], "2026-10-02")).toEqual({
      q: {
        date: { $gte: { $date: start.toISOString() }, $lt: { $date: end.toISOString() } },
        routeId: { $nin: ["70-203"] },
      },
      limit: 0,
    });
  });
});

describe("VEHICLE_SET_INDEXES", () => {
  it("names its indexes the way Prisma names the model's", () => {
    const names = (VEHICLE_SET_INDEXES.indexes as { name: string }[]).map((i) => i.name);
    expect(names).toEqual(["DailyVehicleSet_routeId_date_key", "DailyVehicleSet_date_idx"]);
  });
});

describe("writeVehicleSets", () => {
  it("stores the hours as bits, then marks the day last", async () => {
    aggregateRows.mockResolvedValue([{ _id: "70-203", vs: [{ v: "1", hs: [7, 9] }] }]);
    expect(await writeVehicleSets("2026-10-02")).toBe(1);
    const commands = runCommandRaw.mock.calls.map(([c]) => c as Record<string, unknown>);
    expect(commands.map((c) => Object.entries(c)[0])).toEqual([
      ["createIndexes", "DailyVehicleSet"],
      ["delete", "DailyVehicleSet"],
      ["update", "DailyVehicleSet"],
      ["update", "DailyVehicleSet"],
    ]);
    expect(commands[2]?.updates).toEqual([
      {
        q: { routeId: "70-203", date: DAY },
        u: { $set: { routeId: "70-203", date: DAY, vs: [{ v: "1", h: 2 ** 7 + 2 ** 9 }] } },
        upsert: true,
      },
    ]);
    expect(commands[3]?.updates).toEqual([
      {
        q: { routeId: "*", date: DAY },
        u: { $set: { routeId: "*", date: DAY, vs: [] } },
        upsert: true,
      },
    ]);
  });

  it("still marks a day with no vehicles, so the counts read it as empty", async () => {
    aggregateRows.mockResolvedValue([]);
    expect(await writeVehicleSets("2026-10-02")).toBe(0);
    const commands = runCommandRaw.mock.calls.map(([c]) => c as Record<string, unknown>);
    expect(commands).toHaveLength(3);
    expect(commands[2]?.updates).toMatchObject([{ q: { routeId: "*", date: DAY } }]);
  });
});
