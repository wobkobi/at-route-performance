// tests/lib/data/vehicles-seen.test.ts
// The window and all-time vehicle counts: stored days read from the vehicle sets, every other
// day read through its own day entry, and a day both counts need scanned once.
import {
  getVehicleCounts,
  getVehicleCountsAllTime,
  storedVehiclesPipeline,
} from "@/lib/data/vehicles-seen";
import { nzServiceDayRange } from "@/lib/time/service-day";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { aggregateRows, dayKeys, store } = vi.hoisted(() => ({
  aggregateRows: vi.fn(),
  dayKeys: [] as string[][],
  store: { marks: [] as string[], rows: [] as { v: string; r: string }[] },
}));

vi.mock("@/lib/data/raw", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/raw")>()),
  aggregateRows,
}));
vi.mock("@/lib/data/routes", () => ({
  /**
   * Every vehicle in these tests runs route 70.
   * @returns Route id to mode.
   */
  getRouteModeMap: () => Promise.resolve(new Map([["70-203", "BUS"]])),
}));
vi.mock("@/lib/data/shame-filter", () => ({
  /**
   * No route filter: every route counts.
   * @returns Null.
   */
  worstStopRouteIds: () => Promise.resolve(null),
}));
// Which day entries are read is under test, not the Data Cache wrapper.
vi.mock("@/lib/data/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/cache")>()),
  /**
   * Record the day's key, then run the read uncached.
   * @param fn - The read.
   * @param keyParts - The entry's key.
   * @returns The read's result.
   */
  cachedForDay: <T>(fn: (classified: boolean) => Promise<T>, keyParts: string[]): Promise<T> => {
    dayKeys.push(keyParts);
    return fn(true);
  },
}));
vi.mock("@/lib/mem-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mem-cache")>()),
  /**
   * Run the read uncached, so each test starts cold.
   * @param _key - Unused.
   * @param _ttl - Unused.
   * @param fn - The read.
   * @returns The read's result.
   */
  memCache: <T>(_key: string, _ttl: number, fn: () => Promise<T>): Promise<T> => fn(),
  /**
   * Hand back the read uncached.
   * @param fn - The read.
   * @returns The same read.
   */
  unstable_cache: <T>(fn: T): T => fn,
}));

/** Midday on Monday 14 September 2026, the fourth day on record. */
const NOW = new Date("2026-09-14T00:00:00Z");
/** The days on record so far: 11 to 14 September. */
const FIRST_FOUR = {
  start: nzServiceDayRange("2026-09-11").start,
  end: nzServiceDayRange("2026-09-14").end,
};
const FILTER = { mode: null, schools: "exclude" as const };

/**
 * The arrival scans run so far: calls on ArrivalEvent, not on the stored sets.
 * @returns How many.
 */
function scans(): number {
  return aggregateRows.mock.calls.filter(([collection]) => collection === "ArrivalEvent").length;
}

/**
 * Whether a stored-set read is the marks lookup rather than the union.
 * @param pipeline - The read's stages.
 * @returns True for the marks lookup.
 */
function isMarksRead(pipeline: object[]): boolean {
  return (pipeline[0] as { $match: { routeId: unknown } }).$match.routeId === "*";
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  dayKeys.length = 0;
  store.marks = [];
  store.rows = [];
  aggregateRows.mockReset();
  aggregateRows.mockImplementation((collection: string, pipeline: object[]) => {
    if (collection === "DailyVehicleSet") {
      return Promise.resolve(
        isMarksRead(pipeline) ? store.marks.map(($date) => ({ date: { $date } })) : store.rows,
      );
    }
    // A different vehicle each scan, so a day scanned twice would show in the count. The
    // scan takes a moment, as a real one does, so a second ask finds it still in flight.
    const row = { v: `live-${scans()}`, r: "70-203" };
    return new Promise((resolve) => setTimeout(() => resolve([row]), 5));
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("vehicle counts", () => {
  it("scans each day once when the window and all-time counts ask for it together", async () => {
    const [inWindow, allTime] = await Promise.all([
      getVehicleCounts(FIRST_FOUR, FILTER, 120),
      getVehicleCountsAllTime(FILTER, 120),
    ]);
    expect(scans()).toBe(4);
    expect(inWindow.BUS).toBe(4);
    expect(allTime.BUS).toBe(4);
  });

  it("reads every day on record through its own day entry when none is stored", async () => {
    await getVehicleCountsAllTime(FILTER, 120);
    expect(dayKeys.map(([, date]) => date).sort()).toEqual([
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
    ]);
  });

  it("counts all time from the stored days and scans only the unstored ones", async () => {
    store.marks = [
      nzServiceDayRange("2026-09-11").start.toISOString(),
      nzServiceDayRange("2026-09-12").start.toISOString(),
    ];
    store.rows = [
      { v: "stored-1", r: "70-203" },
      { v: "stored-2", r: "70-203" },
    ];
    const allTime = await getVehicleCountsAllTime(FILTER, 120);
    expect(dayKeys.map(([, date]) => date).sort()).toEqual(["2026-09-13", "2026-09-14"]);
    expect(allTime.BUS).toBe(4);
  });

  it("reads marked days from the stored sets and scans only the rest", async () => {
    store.marks = [
      nzServiceDayRange("2026-09-11").start.toISOString(),
      nzServiceDayRange("2026-09-12").start.toISOString(),
    ];
    store.rows = [
      { v: "stored-1", r: "70-203" },
      { v: "stored-2", r: "70-203" },
    ];
    const counts = await getVehicleCounts(FIRST_FOUR, FILTER, 120);
    expect(dayKeys.map(([, date]) => date).sort()).toEqual(["2026-09-13", "2026-09-14"]);
    expect(counts.BUS).toBe(4);
    const union = aggregateRows.mock.calls.find(
      ([collection, pipeline]) => collection === "DailyVehicleSet" && !isMarksRead(pipeline),
    );
    expect(union?.[1]).toContainEqual({
      $match: expect.objectContaining({ date: { $in: store.marks.map(($date) => ({ $date })) } }),
    });
  });

  it("counts a vehicle once when a stored day and a scanned day both saw it", async () => {
    store.marks = [nzServiceDayRange("2026-09-11").start.toISOString()];
    store.rows = [{ v: "live-1", r: "70-203" }];
    // Three scans, live-1 to live-3, one of them the stored vehicle.
    expect((await getVehicleCounts(FIRST_FOUR, FILTER, 120)).BUS).toBe(3);
  });

  it("reads nothing stored for a window of today alone", async () => {
    await getVehicleCounts(nzServiceDayRange("2026-09-14"), FILTER, 120);
    expect(aggregateRows.mock.calls.map(([collection]) => collection)).toEqual(["ArrivalEvent"]);
  });
});

describe("storedVehiclesPipeline", () => {
  const DAYS = [{ $date: "2026-09-10T16:00:00.000Z" }];

  it("leaves out the day markers when every route counts", () => {
    expect(storedVehiclesPipeline(DAYS, null, null)[0]).toEqual({
      $match: { date: { $in: DAYS }, routeId: { $ne: "*" } },
    });
  });

  it("keeps only the filter's routes", () => {
    expect(storedVehiclesPipeline(DAYS, ["70-203"], null)[0]).toEqual({
      $match: { date: { $in: DAYS }, routeId: { $in: ["70-203"] } },
    });
  });

  it("narrows to vehicles due in the hours by their bits", () => {
    expect(storedVehiclesPipeline(DAYS, null, { from: 7, to: 10 })).toContainEqual({
      $match: { "vs.h": { $bitsAnySet: 896 } },
    });
  });

  it("adds no hour stage for the whole day", () => {
    expect(JSON.stringify(storedVehiclesPipeline(DAYS, null, null))).not.toContain("$bitsAnySet");
  });
});
