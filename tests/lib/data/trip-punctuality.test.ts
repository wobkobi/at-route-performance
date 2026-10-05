// tests/lib/data/trip-punctuality.test.ts
// Which days a window's trip tallies come from (stored or judged live), and the
// lineage fold that sums a CRL line together with the lines it replaced.
import { getTripPunctuality, punctualityForSlugs } from "@/lib/data/trip-punctuality";
import { nzServiceDayRange } from "@/lib/time/service-day";
import type { PunctualityCounts } from "@/lib/trip/punctuality";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { aggregateRows, tripPunctualityOfDay, dayKeys } = vi.hoisted(() => ({
  aggregateRows: vi.fn(),
  tripPunctualityOfDay: vi.fn(),
  dayKeys: [] as string[][],
}));

vi.mock("@/lib/data/raw", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/raw")>()),
  aggregateRows,
}));
vi.mock("@/lib/cron/trip-punctuality", () => ({ DAY_MARKER: "*", tripPunctualityOfDay }));
vi.mock("@/lib/db", () => ({
  /**
   * Swallow the failure as the real fallback does, without logging.
   * @returns A handler resolving to null.
   */
  readFallback: () => () => null,
}));
// Which days are read how is under test, not the Data Cache wrapper; the day keys are kept
// to check which views share a day's entry.
vi.mock("@/lib/data/cache", async (importOriginal) => {
  const { dayEntryRevalidate } = await importOriginal<typeof import("@/lib/data/cache")>();
  /**
   * Run the read uncached.
   * @param fn - The read.
   * @returns The read's result.
   */
  const passthrough = <T>(fn: (classified: boolean) => Promise<T>): Promise<T> => fn(false);
  /**
   * Record the day's key, then run the read uncached.
   * @param fn - The read.
   * @param keyParts - The entry's key.
   * @returns The read's result.
   */
  const perDay = <T>(fn: (classified: boolean) => Promise<T>, keyParts: string[]): Promise<T> => {
    dayKeys.push(keyParts);
    return fn(false);
  };
  return { cachedForDay: perDay, cachedForRange: passthrough, dayEntryRevalidate };
});

/**
 * A tally with every count set to one value, so sums are easy to read.
 * @param n - The value of each count.
 * @returns The tally.
 */
function tally(n: number): PunctualityCounts {
  return { departed: n, reliable: n, timed: n, punctual: n, cancelled: n };
}

/** 2pm NZDT on Monday 5 October 2026, inside that day's service day. */
const NOW = new Date("2026-10-05T01:00:00Z");
const TODAY = nzServiceDayRange("2026-10-05");
/** Saturday to today: one tallied day, one with no complete stored tallies, and today. */
const WINDOW = { start: nzServiceDayRange("2026-10-03").start, end: TODAY.end };

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  aggregateRows.mockReset();
  tripPunctualityOfDay.mockReset();
  dayKeys.length = 0;
  tripPunctualityOfDay.mockImplementation(() => Promise.resolve(new Map([["101-1", tally(1)]])));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getTripPunctuality", () => {
  it("judges live every started day without a complete stored tally, today included", async () => {
    const saturday = { $date: nzServiceDayRange("2026-10-03").start.toISOString() };
    aggregateRows
      .mockResolvedValueOnce([{ date: saturday }])
      .mockResolvedValueOnce([{ _id: "101-1", ...tally(10) }]);
    const byRoute = await getTripPunctuality(WINDOW, 300);
    expect(tripPunctualityOfDay.mock.calls.map(([date]) => date)).toEqual([
      "2026-10-05",
      "2026-10-04",
    ]);
    expect(byRoute).toEqual({ "101-1": tally(12) });
    // The routes' rows are read on the marked days only, the marker left out.
    const rowsMatch = (aggregateRows.mock.calls[1] as [string, { $match: object }[]])[1][0]?.$match;
    expect(rowsMatch).toEqual({ date: { $in: [saturday] }, routeId: { $ne: "*" } });
  });

  it("judges a day live when its write never marked it complete", async () => {
    aggregateRows.mockResolvedValueOnce([]);
    expect(await getTripPunctuality(WINDOW, 300)).toEqual({ "101-1": tally(3) });
    expect(aggregateRows).toHaveBeenCalledTimes(1);
    expect(tripPunctualityOfDay.mock.calls.map(([date]) => date)).toEqual([
      "2026-10-05",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("starts judging today before the stored read returns", async () => {
    const marks = Promise.withResolvers<unknown[]>();
    aggregateRows.mockReturnValueOnce(marks.promise);
    const pending = getTripPunctuality(WINDOW, 300);
    await Promise.resolve();
    expect(tripPunctualityOfDay.mock.calls.map(([date]) => date)).toEqual(["2026-10-05"]);
    marks.resolve([]);
    expect(await pending).toEqual({ "101-1": tally(3) });
  });

  it("shares a day's entry between the week and month, and keeps the day view's faster one", async () => {
    aggregateRows.mockResolvedValue([]);
    await getTripPunctuality(WINDOW, 3600);
    await getTripPunctuality(TODAY, 120);
    expect(dayKeys).toEqual([
      ["trip-punctuality-day", "2026-10-05", "300"],
      ["trip-punctuality-day", "2026-10-03", "300"],
      ["trip-punctuality-day", "2026-10-04", "300"],
      ["trip-punctuality-day", "2026-10-05", "120"],
    ]);
  });

  it("never reads today from stored rows", async () => {
    aggregateRows.mockResolvedValue([]);
    await getTripPunctuality(WINDOW, 300);
    const [[collection, pipeline]] = aggregateRows.mock.calls as [[string, { $match: object }[]]];
    expect(collection).toBe("DailyTripTally");
    expect(pipeline[0]?.$match).toMatchObject({
      date: { $lt: { $date: TODAY.start.toISOString() } },
      routeId: "*",
    });
  });

  it("skips the stored read for a window inside today", async () => {
    await getTripPunctuality(TODAY, 300);
    expect(aggregateRows).not.toHaveBeenCalled();
    expect(tripPunctualityOfDay.mock.calls.map(([date]) => date)).toEqual(["2026-10-05"]);
  });
});

describe("punctualityForSlugs", () => {
  const byRoute = { "STH-201": tally(2), "S-C-201": tally(3), "101-1": tally(5) };

  it("sums a CRL line together with the line it replaced", () => {
    expect(punctualityForSlugs(byRoute, new Set(["S-C"]))).toEqual(tally(5));
  });

  it("leaves a retired line on its own", () => {
    expect(punctualityForSlugs(byRoute, new Set(["STH"]))).toEqual(tally(2));
  });
});
