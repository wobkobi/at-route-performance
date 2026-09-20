// src/lib/range-page.test.ts
// Unit tests for the Day / Week / Month window helpers.
import { DATA_START_DAY } from "@/lib/data-start";
import {
  dayRangeNav,
  hasEarlierDay,
  monthPeriodOf,
  overviewHeading,
  parseRangeWindow,
  periodAnchorDay,
  rangeTabPeriods,
  routeLinkQuery,
  weekPeriodOf,
} from "@/lib/range-page";
import { nzServiceDayRange } from "@/lib/time";
import { describe, expect, it } from "vitest";

const TODAY = "2026-09-14";

describe("parseRangeWindow", () => {
  it("defaults anything but week or month to the day view", () => {
    expect(parseRangeWindow(undefined)).toBe("day");
    expect(parseRangeWindow("year")).toBe("day");
    expect(parseRangeWindow("week")).toBe("week");
    expect(parseRangeWindow("month")).toBe("month");
  });
});

describe("dayRangeNav", () => {
  // After the archive floor, so the live earliest day is what bounds the
  // stepper here rather than DATA_START_DAY standing in for it.
  const earliest = nzServiceDayRange("2026-09-12").start;

  it("stops at today and at the earliest day with data", () => {
    expect(dayRangeNav(TODAY, earliest, TODAY)).toMatchObject({ hasPrev: true, hasNext: false });
    expect(dayRangeNav("2026-09-12", earliest, TODAY)).toMatchObject({
      hasPrev: false,
      hasNext: true,
      nextIsToday: false,
    });
  });

  it("marks yesterday's next link as today", () => {
    expect(dayRangeNav("2026-09-13", earliest, TODAY)).toMatchObject({ nextIsToday: true });
  });

  it("falls back to the archive floor when the earliest day is unknown", () => {
    expect(dayRangeNav(DATA_START_DAY, null, TODAY).hasPrev).toBe(false);
    expect(dayRangeNav("2026-09-12", null, TODAY).hasPrev).toBe(true);
  });
});

describe("routeLinkQuery", () => {
  it("pins only a past day", () => {
    expect(routeLinkQuery("day", TODAY, null, TODAY)).toBe("");
    expect(routeLinkQuery("day", "2026-09-10", null, TODAY)).toBe("?day=2026-09-10");
  });

  it("opens the week view, pinned to a stepped-back week", () => {
    expect(routeLinkQuery("week", null, null, TODAY)).toBe("?window=week");
    expect(routeLinkQuery("week", null, "2026-09-07", TODAY)).toBe(
      "?window=week&period=2026-09-07",
    );
  });

  it("hands a month off to the week its last day falls in, since routes have no month view", () => {
    expect(routeLinkQuery("month", null, "2026-08", TODAY)).toBe("?window=week&period=2026-08-31");
  });

  it("leaves the running month on the rolling week rather than a future one", () => {
    // September still has days to come, so its last day clamps to today, whose
    // week is the rolling default the route page already shows.
    expect(routeLinkQuery("month", null, "2026-09", TODAY)).toBe("?window=week");
  });
});

describe("weekPeriodOf", () => {
  it("keeps today on the rolling week", () => {
    expect(weekPeriodOf(TODAY, TODAY)).toBeNull();
  });

  it("snaps a past day to its Monday", () => {
    expect(weekPeriodOf("2026-09-13", TODAY)).toBe("2026-09-07");
    expect(weekPeriodOf("2026-09-07", TODAY)).toBe("2026-09-07");
    expect(weekPeriodOf("2026-09-01", TODAY)).toBe("2026-08-31");
  });
});

describe("monthPeriodOf", () => {
  it("keeps today on the current month", () => {
    expect(monthPeriodOf(TODAY, TODAY)).toBeNull();
  });

  it("snaps a past day to its month key", () => {
    expect(monthPeriodOf("2026-09-01", TODAY)).toBe("2026-09");
    expect(monthPeriodOf("2026-08-31", TODAY)).toBe("2026-08");
    expect(monthPeriodOf("2025-01-05", TODAY)).toBe("2025-01");
  });
});

describe("periodAnchorDay", () => {
  it("anchors a rolling period to today", () => {
    expect(periodAnchorDay("week", null, TODAY)).toBe(TODAY);
    expect(periodAnchorDay("month", null, TODAY)).toBe(TODAY);
  });

  it("anchors a past period to its last day", () => {
    expect(periodAnchorDay("week", "2026-08-31", TODAY)).toBe("2026-09-06");
    expect(periodAnchorDay("month", "2026-08", TODAY)).toBe("2026-08-31");
    // February, so a month-length table would have to be right about leap years.
    expect(periodAnchorDay("month", "2024-02", TODAY)).toBe("2024-02-29");
    expect(periodAnchorDay("month", "2026-02", TODAY)).toBe("2026-02-28");
  });

  it("clamps a period still running to today", () => {
    expect(periodAnchorDay("week", "2026-09-14", TODAY)).toBe(TODAY);
    expect(periodAnchorDay("month", "2026-09", TODAY)).toBe(TODAY);
  });
});

describe("rangeTabPeriods", () => {
  it("carries nothing when the view is already on today", () => {
    expect(rangeTabPeriods(TODAY, TODAY)).toEqual({ day: null, week: null, month: null });
  });

  it("carries a past day onto every tab", () => {
    expect(rangeTabPeriods("2026-08-20", TODAY)).toEqual({
      day: "2026-08-20",
      week: "2026-08-17",
      month: "2026-08",
    });
  });
});

describe("overviewHeading", () => {
  const tabs = { day: null, week: null, month: null } as const;
  const day = {
    window: "day",
    serviceDate: TODAY,
    hasPrev: true,
    nextIsToday: false,
    atFloor: false,
    tabs,
  } as const;
  const week = {
    window: "week",
    label: "Last 7 days",
    prevHref: null,
    nextHref: null,
    partial: false,
    tabs,
  } as const;

  it("names today, or another day, from the stepper", () => {
    expect(overviewHeading({ ...day, hasNext: false }, null)).toBe("How bad was it today?");
    expect(overviewHeading({ ...day, hasNext: true }, null)).toBe("How bad was it that day?");
  });

  it("tells the current week or month from a stepped-back one", () => {
    expect(overviewHeading(week, null)).toBe("How bad was this week?");
    expect(overviewHeading({ ...week, window: "month" }, "2026-08")).toBe(
      "How bad was that month?",
    );
  });
});

describe("hasEarlierDay", () => {
  it("stops at the constant when no live floor is known", () => {
    expect(hasEarlierDay(DATA_START_DAY, null)).toBe(false);
    expect(hasEarlierDay("2026-09-12", null)).toBe(true);
  });
  it("lets the live floor win once it passes the constant", () => {
    expect(hasEarlierDay("2026-09-12", nzServiceDayRange("2026-09-20").start)).toBe(false);
    expect(hasEarlierDay("2026-09-21", nzServiceDayRange("2026-09-20").start)).toBe(true);
  });
  it("ignores a live floor that sits before the constant", () => {
    // The 10 September remnant must never re-open the stepper.
    expect(hasEarlierDay(DATA_START_DAY, nzServiceDayRange("2026-09-10").start)).toBe(false);
  });
});
