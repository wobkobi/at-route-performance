// src/lib/data/cache.test.ts
// Unit tests for the cache key state of a date-scoped aggregation.
import { cacheState, rangeIsFinal } from "@/lib/data/cache";
import { nzServiceDayRange } from "@/lib/time";
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
    expect(cacheState(false, RANGE, 300, END - 1)).toMatch(/^live-/);
  });

  it("moves a live window to a new key every TTL", () => {
    const a = cacheState(false, RANGE, 300, START + 60_000);
    const b = cacheState(false, RANGE, 300, START + 120_000);
    const c = cacheState(false, RANGE, 300, START + 60_000 + 300_000);
    // START sits on a five-minute boundary, so a and b share a bucket and c is the next.
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(cacheState(false, null, 300, START)).toMatch(/^live-/);
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
    await expect(rangeIsFinal(nzServiceDayRange("2026-09-11"))).resolves.toBe(false);
  });
});
