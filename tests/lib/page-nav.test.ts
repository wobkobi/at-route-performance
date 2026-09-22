// tests/lib/page-nav.test.ts
// Unit tests for the page-nav helpers resolveRequestedDay, resolveWeekNav and filterLiveHours in page-nav.ts.

import { getMostRecentDataDay } from "@/lib/data";
import { DATA_START_DAY, dataStartDate, rangeIsEmpty } from "@/lib/data-start";
import {
  fillServiceHours,
  filterLiveHours,
  maybeFallbackDay,
  resolveActiveWeekRange,
  resolveMonthNav,
  resolveRangeView,
  resolveRequestedDay,
  resolveRequestedMonth,
  resolveWeekNav,
  serviceHourSpan,
} from "@/lib/page-nav";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { nzServiceDayRange } from "@/lib/time";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data", () => ({ getMostRecentDataDay: vi.fn(() => Promise.resolve(null)) }));

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

describe("serviceHourSpan", () => {
  it("orders post-midnight hours after the evening", () => {
    expect(serviceHourSpan([23, 6, 1, 12])).toEqual({ first: 6, last: 1 });
  });
  it("is null with no hours", () => {
    expect(serviceHourSpan([])).toBeNull();
  });
});

describe("fillServiceHours", () => {
  // 2026-06-15T22:30Z == 2026-06-16 10:30 NZST: service day 2026-06-16, hour 10.
  const now = new Date("2026-06-15T22:30:00Z");
  const rows = [
    { hour: 6, id: "a" },
    { hour: 1, id: "b" },
  ];

  it("covers the shared span in service order, empty where this board had nothing", () => {
    const slots = fillServiceHours(rows, "2026-06-10", { first: 5, last: 2 }, now);
    expect(slots.map((s) => s.hour)).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2,
    ]);
    expect(slots.find((s) => s.hour === 6)?.row).toEqual(rows[0]);
    expect(slots.find((s) => s.hour === 1)?.row).toEqual(rows[1]);
    expect(slots.find((s) => s.hour === 2)?.row).toBeNull();
  });
  it("ends where the latest board ends, not at 3am", () => {
    const slots = fillServiceHours(rows, "2026-06-10", { first: 4, last: 0 }, now);
    expect(slots.at(-1)?.hour).toBe(0);
    expect(slots.some((s) => s.hour === 1)).toBe(false);
  });
  it("falls back to the rows' own span", () => {
    const slots = fillServiceHours(rows, "2026-06-10", null, now);
    expect(slots[0]?.hour).toBe(6);
    expect(slots.at(-1)?.hour).toBe(1);
  });
  it("stops at the current hour on the live day", () => {
    const slots = fillServiceHours(rows, "2026-06-16", { first: 4, last: 3 }, now);
    expect(slots.map((s) => s.hour)).toEqual([4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("filterLiveHours", () => {
  // 2026-06-15T22:30Z == 2026-06-16 10:30 NZST (UTC+12): service day 2026-06-16, hour 10.
  const now = new Date("2026-06-15T22:30:00Z");
  const hours = [{ hour: 0 }, { hour: 6 }, { hour: 10 }, { hour: 11 }];

  it("on the live day, keeps only hours up to the current hour (and drops pre-4am)", () => {
    expect(filterLiveHours(hours, "2026-06-16", now)).toEqual([{ hour: 6 }, { hour: 10 }]);
  });
  it("returns every hour unchanged for a past day", () => {
    expect(filterLiveHours(hours, "2026-06-10", now)).toBe(hours);
  });
  it("pre-4am keeps the whole daytime plus elapsed post-midnight hours", () => {
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

  it("at 03:30 keeps the whole daytime plus every elapsed post-midnight hour", () => {
    // 2026-06-15T15:30Z == 2026-06-16 03:30 NZST: still service day 2026-06-15.
    const at0330 = new Date("2026-06-15T15:30:00Z");
    const fullDay = [{ hour: 0 }, { hour: 3 }, { hour: 4 }, { hour: 5 }, { hour: 20 }];
    expect(filterLiveHours(fullDay, "2026-06-15", at0330)).toEqual([
      { hour: 0 },
      { hour: 3 },
      { hour: 4 },
      { hour: 5 },
      { hour: 20 },
    ]);
  });

  it("at 04:30 keeps only the 4am row - the case that is empty today", () => {
    // 2026-06-15T16:30Z == 2026-06-16 04:30 NZST: the new day's first hour.
    const at0430 = new Date("2026-06-15T16:30:00Z");
    const fullDay = [{ hour: 0 }, { hour: 3 }, { hour: 4 }, { hour: 5 }, { hour: 20 }];
    expect(filterLiveHours(fullDay, "2026-06-16", at0430)).toEqual([{ hour: 4 }]);
  });

  it("at 06:30 keeps hours 4, 5 and 6", () => {
    // 2026-06-15T18:30Z == 2026-06-16 06:30 NZST.
    const at0630 = new Date("2026-06-15T18:30:00Z");
    const fullDay = [{ hour: 3 }, { hour: 4 }, { hour: 5 }, { hour: 6 }, { hour: 7 }];
    expect(filterLiveHours(fullDay, "2026-06-16", at0630)).toEqual([
      { hour: 4 },
      { hour: 5 },
      { hour: 6 },
    ]);
  });
});

describe("resolveRequestedMonth", () => {
  it("accepts a valid month key and rejects everything else", () => {
    expect(resolveRequestedMonth("2026-06")).toBe("2026-06");
    expect(resolveRequestedMonth("2026-13")).toBeNull();
    expect(resolveRequestedMonth("2026-00")).toBeNull();
    expect(resolveRequestedMonth("2026-06-15")).toBeNull();
    expect(resolveRequestedMonth(undefined)).toBeNull();
  });
});

describe("resolveMonthNav", () => {
  // 2026-07-07 12:00 NZST: the current month is 2026-07.
  const now = new Date("2026-07-07T00:00:00Z");
  const oldEarliest = new Date("2026-01-01T00:00:00Z");
  /**
   * Test stub encoding a month period as a recognisable href.
   * @param period - The month period, or null for the current month.
   * @returns A stub href like "month:2026-06" or "month:current".
   */
  const monthHref = (period: string | null): string => `month:${period ?? "current"}`;

  it("current month: label, prev steps back, no next", () => {
    const nav = resolveMonthNav({
      periodParam: null,
      earliestDay: oldEarliest,
      makeHref: monthHref,
      now,
    });
    expect(nav.periodLabel).toBe("July 2026");
    expect(nav.prevHref).toBe("month:2026-06");
    expect(nav.nextHref).toBeNull();
  });
  it("fixed past month: next snaps to the current month; prev bounded by earliest", () => {
    const nav = resolveMonthNav({
      periodParam: "2026-06",
      earliestDay: new Date("2026-06-10T00:00:00Z"),
      makeHref: monthHref,
      now,
    });
    expect(nav.nextHref).toBe("month:current");
    expect(nav.prevHref).toBeNull();
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

describe("partial periods at the archive floor", () => {
  const now = new Date("2026-09-16T00:00:00Z");
  /**
   * Test stub encoding a month period as a recognisable href.
   * @param period - The month period, or null for the current month.
   * @returns A stub href like "month:2026-09" or "month:current".
   */
  const monthHref = (period: string | null): string => `month:${period ?? "current"}`;

  it("marks the first week partial and refuses to step before it", () => {
    const nav = resolveWeekNav({
      periodParam: "2026-09-07",
      earliestDay: dataStartDate(),
      makeHref,
      now,
    });
    expect(nav.prevHref).toBeNull();
    expect(nav.partial).toBe(true);
  });

  it("marks the second week whole and offers a step back", () => {
    const nav = resolveWeekNav({
      periodParam: "2026-09-14",
      earliestDay: dataStartDate(),
      makeHref,
      now,
    });
    expect(nav.prevHref).toBe("week:2026-09-07");
    expect(nav.partial).toBe(false);
  });

  it("marks the first month partial with no chevron in either direction", () => {
    const nav = resolveMonthNav({
      periodParam: "2026-09",
      earliestDay: dataStartDate(),
      makeHref: monthHref,
      now,
    });
    expect(nav).toMatchObject({ prevHref: null, nextHref: null, partial: true });
  });

  it("raises the first week's query window to the floor", () => {
    const { activeWeekRange } = resolveActiveWeekRange("2026-09-07", now);
    expect(activeWeekRange.start.toISOString()).toBe(
      nzServiceDayRange(DATA_START_DAY).start.toISOString(),
    );
    expect(rangeIsEmpty(activeWeekRange)).toBe(false);
  });

  it("raises a month board's window to the floor too", () => {
    const view = resolveRangeView("month", "2026-09", dataStartDate(), monthHref);
    expect(view.activeRange.start.toISOString()).toBe(
      nzServiceDayRange(DATA_START_DAY).start.toISOString(),
    );
    expect(view.partial).toBe(true);
  });
});

describe("maybeFallbackDay", () => {
  it("never falls back from a requested day, so a clamped redirect stays put", async () => {
    await expect(maybeFallbackDay(DATA_START_DAY, true, MIN_BOARD_EVENTS)).resolves.toBeNull();
    expect(getMostRecentDataDay).not.toHaveBeenCalled();
  });

  it("still falls back on a sparse today, where the forward clamp dropped ?day", async () => {
    await maybeFallbackDay(null, true, MIN_BOARD_EVENTS);
    expect(getMostRecentDataDay).toHaveBeenCalledWith(MIN_BOARD_EVENTS);
  });
});
