// tests/lib/data/cache.test.ts
// Unit tests for the cache key state of a date-scoped aggregation.
import {
  cacheKey,
  cacheState,
  dayEntryRevalidate,
  rangeIsFinal,
  scheduledAtWindow,
  windowEnd,
} from "@/lib/data/cache";
import { nzServiceDayRange, nzWeekRange } from "@/lib/time/service-day";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: { dailyRouteSummary: { findFirst } } }));
vi.mock("@/lib/mem-cache", () => ({
  /**
   * Passthrough stand-in for Next's file-backed Data Cache, which has no server
   * to talk to under vitest's node environment. Leaves the read itself
   * assertable without changing what `summaryExistsFor` does.
   * @param fn - The read to run.
   * @returns A thunk running the read uncached.
   */
  unstable_cache:
    <T>(fn: () => Promise<T>) =>
    (): Promise<T> =>
      fn(),
  /**
   * Run the read uncached, so only the module's own memory of summarised days is under test.
   * @param _key - The entry's key.
   * @param _ttl - The entry's TTL.
   * @param fn - The read.
   * @returns The read's result.
   */
  memCache: <T>(_key: string, _ttl: number, fn: () => Promise<T>): Promise<T> => fn(),
}));

const START = Date.parse("2026-09-13T17:00:00Z");
const END = Date.parse("2026-09-14T17:00:00Z");
const RANGE = { start: new Date(START), end: new Date(END) };

describe("cacheState", () => {
  it("holds a summarised window under one key", () => {
    expect(cacheState(true, RANGE, 300, END + 86_400_000)).toBe("final");
  });

  it("gives a finished but unsummarised window its own key, apart from the live one", () => {
    expect(cacheState(false, RANGE, 300, END)).toBe("ended");
    // 4:59am on the 15th, NZ time: already that service day.
    expect(cacheState(false, RANGE, 300, END - 1)).toBe("open-2026-09-15");
  });

  it("holds the live day under one key all day, so a stale entry is there to serve", () => {
    // Mon 14 Sep 2026, 6am and 10pm NZST: many ingest runs apart, one entry.
    const day = nzServiceDayRange("2026-09-14");
    const morning = Date.parse("2026-09-13T18:00:00Z");
    const night = Date.parse("2026-09-14T10:00:00Z");
    expect(cacheState(false, day, 120, morning)).toBe("open-2026-09-14");
    expect(cacheState(false, day, 120, night)).toBe("open-2026-09-14");
  });

  it("holds an open week under one key per service day", () => {
    const week = {
      start: nzServiceDayRange("2026-09-14").start,
      end: nzServiceDayRange("2026-09-20").end,
    };
    // Tuesday 15 Sep, 10am and 6pm NZST: one entry.
    const morning = Date.parse("2026-09-14T22:00:00Z");
    const evening = Date.parse("2026-09-15T06:00:00Z");
    const a = cacheState(false, week, 3600, morning);
    expect(a).toBe("open-2026-09-15");
    expect(cacheState(false, week, 3600, evening)).toBe(a);
    // Wednesday: a new service day starts a new entry.
    const wednesday = Date.parse("2026-09-15T22:00:00Z");
    expect(cacheState(false, week, 3600, wednesday)).toBe("open-2026-09-16");
  });

  it("keeps a week open until its last service day ends at Monday 4am", () => {
    // Mon 21 Sep 2026 01:30 NZST: Sunday 20 Sep's service day is still running.
    const week = nzWeekRange("2026-09-14");
    const monday = Date.parse("2026-09-20T13:30:00Z");
    expect(cacheState(false, week, 3600, monday)).toBe("open-2026-09-20");
    expect(cacheState(false, week, 3600, week.end.getTime())).toBe("ended");
  });

  it("moves a rolling window with no range to a new key every TTL", () => {
    const a = cacheState(false, null, 300, START + 60_000);
    const b = cacheState(false, null, 300, START + 120_000);
    const c = cacheState(false, null, 300, START + 60_000 + 300_000);
    // START sits on a five-minute boundary, so a and b share a bucket and c is the next.
    expect(a).toMatch(/^live-/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
});

describe("rangeIsFinal", () => {
  beforeEach(() => {
    findFirst.mockReset();
  });

  it("matches the stored stamp by service-day range, not by equality", async () => {
    findFirst.mockResolvedValue({ id: "sum1" });
    const day = nzServiceDayRange("2026-09-11");
    await expect(rangeIsFinal(day)).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { date: { gte: day.start, lt: day.end } },
      select: { id: true },
    });
  });

  it("is false while any day in the window has no summary row", async () => {
    findFirst.mockResolvedValue(null);
    await expect(rangeIsFinal(nzServiceDayRange("2026-09-12"))).resolves.toBe(false);
  });

  it("remembers a summarised day, and asks again about one that had none", async () => {
    findFirst.mockResolvedValue({ id: "sum1" });
    const day = nzServiceDayRange("2026-09-13");
    await rangeIsFinal(day);
    await rangeIsFinal(day);
    expect(findFirst).toHaveBeenCalledTimes(1);
    findFirst.mockResolvedValue(null);
    const open = nzServiceDayRange("2026-09-14");
    await rangeIsFinal(open);
    await rangeIsFinal(open);
    expect(findFirst).toHaveBeenCalledTimes(3);
  });
});

describe("dayEntryRevalidate", () => {
  it("gives today one TTL and every other day another, whoever asks", () => {
    expect(dayEntryRevalidate("2026-10-05", "2026-10-05")).toBe(120);
    expect(dayEntryRevalidate("2026-10-04", "2026-10-05")).toBe(300);
  });
});

describe("cacheKey", () => {
  it("leads with the classification version, so a repaired day cannot serve its old numbers", () => {
    // A recompute changes neither the caller's key parts nor the seven-day TTL,
    // and unstable_cache persists entries across deployments, so the version is
    // the only thing that can retire a stale board.
    expect(cacheKey(["worst-trips", "152"], "final")).toEqual([
      expect.stringMatching(/^g\d+$/),
      "worst-trips",
      "152",
      "final",
    ]);
  });
});

describe("windowEnd", () => {
  it("clips an open window to now, so nothing is measured against stops not yet due", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T22:00:00Z"));
    // 10am NZ on the 24th: the service day runs to 4am on the 25th.
    const open = nzServiceDayRange("2026-09-24");
    expect(windowEnd(open).toISOString()).toBe("2026-09-23T22:00:00.000Z");
    vi.useRealTimers();
  });

  it("leaves a window that has already ended exactly as it is", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T22:00:00Z"));
    const past = nzServiceDayRange("2026-09-20");
    expect(windowEnd(past).getTime()).toBe(past.end.getTime());
    vi.useRealTimers();
  });

  it("agrees with the bound scheduledAtWindow sends to MongoDB", () => {
    // The cancellation penalty stops at windowEnd and the arrivals stop at
    // scheduledAtWindow's `$lt`. They have to be the same instant, or one side
    // counts a trip the other does not.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T22:00:00Z"));
    const open = nzServiceDayRange("2026-09-24");
    expect(scheduledAtWindow(open).$lt.$date).toBe(windowEnd(open).toISOString());
    vi.useRealTimers();
  });
});
