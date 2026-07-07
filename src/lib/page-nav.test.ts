// src/lib/page-nav.test.ts
/**
 * @description Unit tests for the page-nav helpers resolveRequestedDay, resolveWeekNav and filterLiveHours in page-nav.ts.
 */
import { filterLiveHours, resolveRequestedDay, resolveWeekNav } from "@/lib/page-nav";
import { describe, expect, it } from "vitest";

/**
 * Test stub for `resolveWeekNav`'s `makeHref`: encode a week period as a
 * recognisable href so assertions can check which period was linked.
 * @param period - The week period, or null for the rolling current week.
 * @returns A stub href like "week:2026-06-08" or "week:current".
 */
function makeHref(period: string | null): string {
  return `week:${period ?? "current"}`;
}

describe("resolveRequestedDay", () => {
  it("accepts a valid ISO date", () => {
    expect(resolveRequestedDay("2026-06-15")).toBe("2026-06-15");
  });
  it("rejects non-ISO or absent values", () => {
    expect(resolveRequestedDay("2026-6-5")).toBeNull();
    expect(resolveRequestedDay("today")).toBeNull();
    expect(resolveRequestedDay(undefined)).toBeNull();
    expect(resolveRequestedDay("")).toBeNull();
  });
  it("rejects shape-valid but impossible calendar dates", () => {
    expect(resolveRequestedDay("2026-02-31")).toBeNull();
    expect(resolveRequestedDay("2026-13-01")).toBeNull();
    expect(resolveRequestedDay("2026-00-10")).toBeNull();
    // Leap-day handling: 2024 is a leap year, 2026 is not.
    expect(resolveRequestedDay("2024-02-29")).toBe("2024-02-29");
    expect(resolveRequestedDay("2026-02-29")).toBeNull();
  });
});

describe("filterLiveHours", () => {
  // 2026-06-15T22:30Z == 2026-06-16 10:30 NZST (UTC+12): service day 2026-06-16, hour 10.
  const now = new Date("2026-06-15T22:30:00Z");
  const hours = [{ hour: 0 }, { hour: 6 }, { hour: 10 }, { hour: 11 }];

  it("on the live day, keeps only hours up to the current hour (and drops pre-5am)", () => {
    expect(filterLiveHours(hours, "2026-06-16", now)).toEqual([{ hour: 6 }, { hour: 10 }]);
  });
  it("returns every hour unchanged for a past day", () => {
    expect(filterLiveHours(hours, "2026-06-10", now)).toBe(hours);
  });
  it("pre-5am keeps the whole daytime plus elapsed post-midnight hours", () => {
    // 2026-06-15T14:30Z == 2026-06-16 02:30 NZST: still service day 2026-06-15, hour 2.
    const overnight = new Date("2026-06-15T14:30:00Z");
    const fullDay = [{ hour: 0 }, { hour: 2 }, { hour: 3 }, { hour: 6 }, { hour: 18 }];
    expect(filterLiveHours(fullDay, "2026-06-15", overnight)).toEqual([
      { hour: 0 },
      { hour: 2 },
      { hour: 6 },
      { hour: 18 },
    ]);
  });
});

describe("resolveWeekNav", () => {
  // 2026-06-15 is a Monday (NZ): this week's start is 2026-06-15.
  const now = new Date("2026-06-15T00:00:00Z");
  const oldEarliest = new Date("2026-01-01T00:00:00Z");

  it("rolling window: label is 'Last 7 days', prev steps back, no next", () => {
    const nav = resolveWeekNav({ periodParam: null, earliestDay: oldEarliest, makeHref, now });
    expect(nav.periodLabel).toBe("Last 7 days");
    expect(nav.prevHref).toBe("week:2026-06-08");
    expect(nav.nextHref).toBeNull();
  });
  it("fixed past week: prev and next both present, next snaps to current", () => {
    const nav = resolveWeekNav({
      periodParam: "2026-06-08",
      earliestDay: oldEarliest,
      makeHref,
      now,
    });
    expect(nav.prevHref).toBe("week:2026-06-01");
    expect(nav.nextHref).toBe("week:current");
  });
  it("bounds prev at the earliest week with data", () => {
    const nav = resolveWeekNav({
      periodParam: "2026-06-08",
      earliestDay: new Date("2026-06-10T00:00:00Z"), // week of Mon 2026-06-08
      makeHref,
      now,
    });
    expect(nav.prevHref).toBeNull();
  });
});
