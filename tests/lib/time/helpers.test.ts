// tests/lib/time/helpers.test.ts
// Unit tests for the shared date-key, month and ?d= helpers in service-day.ts.

import {
  dashedDate,
  isRealDate,
  mondayOf,
  monthLabel,
  monthLastDay,
  nzServiceDayRange,
  nzServiceDayString,
  parseInstantParam,
  serviceDayClockInstant,
  weekdayOf,
  YM_RE,
  ymKey,
} from "@/lib/time/service-day";
import { describe, expect, it } from "vitest";

describe("isRealDate", () => {
  it("accepts a real date and rejects one Date.UTC would normalise", () => {
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("2026-02-31")).toBe(false);
    expect(isRealDate("2026-2-1")).toBe(false);
  });
});

describe("dashedDate", () => {
  it("dashes AT's compact date", () => {
    expect(dashedDate("20260920")).toBe("2026-09-20");
    expect(dashedDate("2026092")).toBeNull();
    expect(dashedDate(20260920)).toBeNull();
  });
});

describe("month keys", () => {
  it("pads the month", () => {
    expect(ymKey(2026, 9)).toBe("2026-09");
  });
  it("only matches a real month number", () => {
    expect(YM_RE.test("2026-12")).toBe(true);
    expect(YM_RE.test("2026-13")).toBe(false);
    expect(YM_RE.test("2026-00")).toBe(false);
  });
  it("names the month and finds its last day", () => {
    expect(monthLabel("2026-09")).toBe("September 2026");
    expect(monthLastDay("2026-09")).toBe("2026-09-30");
    expect(monthLastDay("2028-02")).toBe("2028-02-29");
    expect(monthLastDay("2026-12")).toBe("2026-12-31");
  });
});

describe("weekdays", () => {
  it("reads the calendar date, not an Auckland instant", () => {
    expect(weekdayOf("2026-09-20")).toBe(0);
    expect(weekdayOf("2026-09-21")).toBe(1);
  });
  it("steps back to the Monday across a month boundary", () => {
    expect(mondayOf("2026-10-04")).toBe("2026-09-28");
    expect(mondayOf("2026-09-28")).toBe("2026-09-28");
  });
});

describe("parseInstantParam", () => {
  it("reads an ISO instant", () => {
    expect(parseInstantParam("2026-09-20T07:30:00.000Z")?.toISOString()).toBe(
      "2026-09-20T07:30:00.000Z",
    );
  });
  it("reads a bare service date inside its own service day", () => {
    const at = parseInstantParam("2026-09-20");
    expect(at && nzServiceDayString(at)).toBe("2026-09-20");
  });
  it("rejects nothing, junk and impossible dates", () => {
    expect(parseInstantParam(undefined)).toBeNull();
    expect(parseInstantParam("soon")).toBeNull();
    expect(parseInstantParam("2026-02-31")).toBeNull();
  });
});

describe("serviceDayClockInstant boundary hour", () => {
  it("resolves against the hour the day was built with", () => {
    const start = nzServiceDayRange("2026-09-15", 5).start;
    // 04:30 is before a 5am boundary, so it is the post-midnight run of this day.
    const at = serviceDayClockInstant(start, 4.5 * 3600, 5);
    expect(at.getTime() - start.getTime()).toBe(23.5 * 3600 * 1000);
  });
});
