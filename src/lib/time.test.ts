import { isoWeekString, nzDayRange, nzMonthRange, nzWeekRange } from "@/lib/time";
import { describe, expect, it } from "vitest";

describe("nzDayRange", () => {
  it("covers one Auckland calendar day in winter (NZST, UTC+12)", () => {
    // 2026-06-15 12:00 NZST == 2026-06-15 00:00 UTC.
    const { start, end } = nzDayRange(new Date("2026-06-15T00:00:00Z"));
    // Local day 2026-06-15 starts 2026-06-14T12:00Z and ends 2026-06-15T12:00Z.
    expect(start.toISOString()).toBe("2026-06-14T12:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });
  it("covers one Auckland calendar day in summer (NZDT, UTC+13)", () => {
    // January is NZDT (+13): local day starts at 11:00Z the previous date.
    const { start, end } = nzDayRange(new Date("2026-01-15T00:00:00Z"));
    expect(start.toISOString()).toBe("2026-01-14T11:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-15T11:00:00.000Z");
  });
});

describe("nzWeekRange", () => {
  it("round-trips with isoWeekString", () => {
    const { start } = nzWeekRange("2026-W25");
    expect(isoWeekString(start)).toBe("2026-W25");
  });
  it("spans exactly seven days", () => {
    const { start, end } = nzWeekRange("2026-W25");
    expect(end.getTime() - start.getTime()).toBe(7 * 86_400_000);
  });
});

describe("nzMonthRange", () => {
  it("covers June 2026 in Auckland local time (NZST)", () => {
    const { start, end } = nzMonthRange("2026-06");
    // 2026-06-01 00:00 NZST == 2026-05-31T12:00Z; 2026-07-01 00:00 NZST == 2026-06-30T12:00Z.
    expect(start.toISOString()).toBe("2026-05-31T12:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-30T12:00:00.000Z");
  });
});

describe("isoWeekString", () => {
  it("labels a known date", () => {
    expect(isoWeekString(new Date("2026-06-15T00:00:00Z"))).toBe("2026-W25");
  });
});
