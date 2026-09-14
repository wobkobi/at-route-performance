// src/lib/range-page.test.ts
// Unit tests for the Day / Week / Month window helpers.
import { dayRangeNav, parseRangeWindow, routeLinkQuery } from "@/lib/range-page";
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
  const earliest = nzServiceDayRange("2026-09-01").start;

  it("stops at today and at the earliest day with data", () => {
    expect(dayRangeNav(TODAY, earliest, TODAY)).toMatchObject({ hasPrev: true, hasNext: false });
    expect(dayRangeNav("2026-09-01", earliest, TODAY)).toMatchObject({
      hasPrev: false,
      hasNext: true,
      nextIsToday: false,
    });
  });

  it("marks yesterday's next link as today", () => {
    expect(dayRangeNav("2026-09-13", earliest, TODAY)).toMatchObject({ nextIsToday: true });
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

  it("sends a month to the route's default view, which has no month", () => {
    expect(routeLinkQuery("month", null, "2026-09", TODAY)).toBe("");
  });
});
