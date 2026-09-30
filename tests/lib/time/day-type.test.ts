import { datesOfType, dayTypeLabel, dayTypeOf, parseDayType } from "@/lib/time/day-type";
import { describe, expect, it } from "vitest";

describe("parseDayType", () => {
  it("reads the three keys and refuses anything else", () => {
    expect(parseDayType("weekday")).toBe("weekday");
    expect(parseDayType("sat")).toBe("sat");
    expect(parseDayType("sun")).toBe("sun");
    expect(parseDayType("monday")).toBeNull();
    expect(parseDayType(undefined)).toBeNull();
  });
});

describe("dayTypeOf", () => {
  it("names a service date's day, across the DST change", () => {
    // 27 Sep 2026 is the Sunday NZ moves its clocks forward.
    expect(dayTypeOf("2026-09-25")).toBe("weekday");
    expect(dayTypeOf("2026-09-26")).toBe("sat");
    expect(dayTypeOf("2026-09-27")).toBe("sun");
    expect(dayTypeOf("2026-09-28")).toBe("weekday");
  });
});

describe("datesOfType", () => {
  const week = ["2026-09-21", "2026-09-22", "2026-09-26", "2026-09-27"];

  it("keeps the matching dates in order, or every date with no filter", () => {
    expect(datesOfType(week, "weekday")).toEqual(["2026-09-21", "2026-09-22"]);
    expect(datesOfType(week, "sun")).toEqual(["2026-09-27"]);
    expect(datesOfType(week, null)).toEqual(week);
  });
});

describe("dayTypeLabel", () => {
  it("names the filter, or every day without one", () => {
    expect(dayTypeLabel("sat")).toBe("Saturdays");
    expect(dayTypeLabel(null)).toBe("Every day");
  });
});
