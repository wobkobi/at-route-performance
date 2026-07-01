// src/lib/time.test.ts
/**
 * @description Unit tests for the Auckland-timezone day, week and month range helpers in time.ts.
 */
import { nzDayRange, nzMonthRange, nzWeekRange, nzWeekStart } from "@/lib/time";
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

describe("nzWeekRange (Monday start)", () => {
  it("snaps any date to its local Monday and spans seven days", () => {
    // 2026-06-17 is a Wednesday; its week's Monday is 2026-06-15.
    // 2026-06-15 00:00 NZST == 2026-06-14T12:00Z.
    const { start, end } = nzWeekRange("2026-06-17");
    expect(start.toISOString()).toBe("2026-06-14T12:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(7 * 86_400_000);
  });
  it("round-trips with nzWeekStart", () => {
    const { start } = nzWeekRange("2026-06-15");
    expect(nzWeekStart(start)).toBe("2026-06-15");
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

describe("nzWeekStart", () => {
  it("returns the Monday of the week", () => {
    expect(nzWeekStart(new Date("2026-06-17T00:00:00Z"))).toBe("2026-06-15");
  });
});
