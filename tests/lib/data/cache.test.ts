// tests/lib/data/cache.test.ts
// Unit tests for the cache key state of a date-scoped aggregation.
import { cacheKey, cacheState, rangeIsFinal, runIndependentState } from "@/lib/data/cache";
import { nzServiceDayRange, nzWeekRange } from "@/lib/time";
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

  it("keys a live window by the ingest run behind it once one is logged", () => {
    const run = START + 30_000;
    expect(cacheState(false, RANGE, 120, START + 60_000, run)).toBe(`run-${run}`);
    expect(cacheState(false, null, 120, START + 60_000, run)).toBe(`run-${run}`);
  });

  it("turns a live entry over when a run lands, not when a clock bucket rolls", () => {
    const run = START + 30_000;
    // Either side of a two-minute bucket boundary, but behind the same run: one entry.
    const before = cacheState(false, RANGE, 120, START + 119_000, run);
    const after = cacheState(false, RANGE, 120, START + 121_000, run);
    expect(after).toBe(before);
    // Inside one bucket, but a new run has landed: a new entry.
    const next = cacheState(false, RANGE, 120, START + 60_000, run + 120_000);
    expect(next).not.toBe(cacheState(false, RANGE, 120, START + 60_000, run));
  });

  it("holds an open week under one key per service day, whatever the run", () => {
    const week = {
      start: nzServiceDayRange("2026-09-14").start,
      end: nzServiceDayRange("2026-09-20").end,
    };
    // Tuesday 15 Sep, 10am and 6pm NZST: two runs apart, one entry.
    const morning = Date.parse("2026-09-14T22:00:00Z");
    const evening = Date.parse("2026-09-15T06:00:00Z");
    const a = cacheState(false, week, 3600, morning, morning - 60_000);
    expect(a).toBe("open-2026-09-15");
    expect(cacheState(false, week, 3600, evening, evening - 60_000)).toBe(a);
    // Wednesday: a new service day starts a new entry.
    const wednesday = Date.parse("2026-09-15T22:00:00Z");
    expect(cacheState(false, week, 3600, wednesday, wednesday - 60_000)).toBe("open-2026-09-16");
    // A single live day keeps the exact-to-the-run key.
    expect(cacheState(false, nzServiceDayRange("2026-09-15"), 120, morning, 1)).toBe("run-1");
  });

  it("keeps a week open until its last service day ends at Monday 4am", () => {
    // Mon 21 Sep 2026 01:30 NZST: Sunday 20 Sep's service day is still running.
    const week = nzWeekRange("2026-09-14");
    const monday = Date.parse("2026-09-20T13:30:00Z");
    expect(cacheState(false, week, 3600, monday, monday - 60_000)).toBe("open-2026-09-20");
    expect(cacheState(false, week, 3600, week.end.getTime())).toBe("ended");
  });

  it("lets a finished window's state win over the run behind it", () => {
    expect(cacheState(true, RANGE, 120, END + 1, END)).toBe("final");
    expect(cacheState(false, RANGE, 120, END, END - 1)).toBe("ended");
  });
});

describe("runIndependentState", () => {
  const WEEK = nzWeekRange("2026-09-14");
  const MID_WEEK = Date.parse("2026-09-16T02:00:00Z");

  it("answers for every window but the single live day", () => {
    expect(runIndependentState(true, RANGE, END + 86_400_000)).toBe("final");
    expect(runIndependentState(false, RANGE, END)).toBe("ended");
    expect(runIndependentState(false, WEEK, MID_WEEK)).toBe("open-2026-09-16");
    // Only here is the run stamp the deciding part of the key.
    expect(runIndependentState(false, RANGE, START + 60_000)).toBeNull();
    expect(runIndependentState(false, null, START)).toBeNull();
  });

  it("answers exactly when the run stamp cannot change the key", () => {
    // The guarantee `cachedForRange` relies on to skip the lookup: wherever this
    // returns a state, passing a run must make no difference to `cacheState`. If
    // the two ever disagree, a window would be cached under a key built without
    // a stamp it actually needed.
    const cases: [boolean, typeof RANGE | null, number][] = [
      [true, RANGE, END + 86_400_000],
      [false, RANGE, END],
      [false, RANGE, END + 1],
      [false, RANGE, START + 60_000],
      [false, WEEK, MID_WEEK],
      [false, WEEK, WEEK.end.getTime()],
      [false, null, START],
      [false, nzServiceDayRange("2026-09-15"), MID_WEEK],
    ];
    for (const [final, range, now] of cases) {
      const run = now - 60_000;
      const withRun = cacheState(final, range, 120, now, run);
      const withoutRun = cacheState(final, range, 120, now, null);
      expect(runIndependentState(final, range, now) !== null).toBe(withRun === withoutRun);
    }
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
