// tests/lib/data/rankings.test.ts
// The window rankings: each live day read through its own day entry, outside the
// window's cached callback, where a nested Data Cache read would be skipped.
import { getRankings } from "@/lib/data/rankings";
import { nzServiceDayRange } from "@/lib/time/service-day";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dayReads, rangeKeys, insideRange } = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return {
    dayReads: [] as { key: string[]; nested: boolean }[],
    rangeKeys: [] as string[][],
    insideRange: new AsyncLocalStorage<true>(),
  };
});

vi.mock("@/lib/data/raw", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/raw")>()),
  /**
   * No summarised days and no arrivals: which reads run is under test, not their rows.
   * @returns No rows.
   */
  aggregateRows: () => Promise.resolve([]),
}));
vi.mock("@/lib/data/rider-wait", () => ({
  /**
   * No cancellations.
   * @returns No penalties.
   */
  getRouteRiderWait: () => Promise.resolve({}),
}));
vi.mock("@/lib/data/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/cache")>()),
  /**
   * Record the window's key, then run the read uncached, marked as inside a window entry.
   * @param fn - The read.
   * @param keyParts - The entry's key.
   * @returns The read's result.
   */
  cachedForRange: <T>(fn: (classified: boolean) => Promise<T>, keyParts: string[]): Promise<T> => {
    rangeKeys.push(keyParts);
    return insideRange.run(true, () => fn(true));
  },
  /**
   * Record the day's key and whether a window entry's read called it, then run it uncached.
   * @param fn - The read.
   * @param keyParts - The entry's key.
   * @returns The read's result.
   */
  cachedForDay: <T>(fn: (classified: boolean) => Promise<T>, keyParts: string[]): Promise<T> => {
    dayReads.push({ key: keyParts, nested: insideRange.getStore() === true });
    return fn(true);
  },
}));

/** 2pm NZDT on Monday 5 October 2026. */
const NOW = new Date("2026-10-05T01:00:00Z");
/** Saturday 3 to Monday 5 October, none of it summarised. */
const THREE_DAYS = {
  start: nzServiceDayRange("2026-10-03").start,
  end: nzServiceDayRange("2026-10-05").end,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  dayReads.length = 0;
  rangeKeys.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getRankings", () => {
  it("reads every unsummarised day through its own entry, outside the window entry", async () => {
    await getRankings(THREE_DAYS, 3600);
    expect(rangeKeys.map(([name]) => name)).toEqual(["rankings-summary"]);
    expect(dayReads.map(({ key: [, date] }) => date).sort()).toEqual([
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
    expect(dayReads.every(({ nested }) => !nested)).toBe(true);
  });

  it("gives today a faster view its own entry, and shares every other day's", async () => {
    await getRankings(THREE_DAYS, 120);
    expect(Object.fromEntries(dayReads.map(({ key: [, date, ttl] }) => [date, ttl]))).toEqual({
      "2026-10-03": "300",
      "2026-10-04": "300",
      "2026-10-05": "120",
    });
  });
});
