// tests/lib/data/vehicles-seen.test.ts
// The window and all-time vehicle counts: each day read through its own day entry,
// and a day both counts need scanned once.
import { getVehicleCounts, getVehicleCountsAllTime } from "@/lib/data/vehicles-seen";
import { nzServiceDayRange } from "@/lib/time/service-day";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { aggregateRows, dayKeys } = vi.hoisted(() => ({
  aggregateRows: vi.fn(),
  dayKeys: [] as string[][],
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
}));

/** Midday on Monday 14 September 2026, the fourth day on record. */
const NOW = new Date("2026-09-14T00:00:00Z");
/** The days on record so far: 11 to 14 September. */
const FIRST_FOUR = {
  start: nzServiceDayRange("2026-09-11").start,
  end: nzServiceDayRange("2026-09-14").end,
};
const FILTER = { mode: null, schools: "exclude" as const };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  dayKeys.length = 0;
  aggregateRows.mockReset();
  // A different vehicle each scan, so a day scanned twice would show in the count.
  aggregateRows.mockImplementation(() =>
    Promise.resolve([{ v: String(aggregateRows.mock.calls.length), r: "70-203" }]),
  );
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
    expect(aggregateRows).toHaveBeenCalledTimes(4);
    expect(inWindow.BUS).toBe(4);
    expect(allTime.BUS).toBe(4);
  });

  it("reads every day on record through its own day entry", async () => {
    await getVehicleCountsAllTime(FILTER, 120);
    expect(dayKeys.map(([, date]) => date).sort()).toEqual([
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
    ]);
  });
});
