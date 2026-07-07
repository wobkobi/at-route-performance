// src/lib/time.test.ts
/**
 * @description Unit tests for the Auckland-timezone day, week and month range helpers in time.ts.
 */
import {
  nzDayRange,
  nzLast7DaysRange,
  nzMonthRange,
  nzWeekRange,
  nzWeekStart,
  serviceDatesInRange,
} from "@/lib/time";
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

describe("serviceDatesInRange", () => {
  it("yields exactly the seven calendar days Mon to Sun for a midnight-aligned week", () => {
    expect(serviceDatesInRange(nzWeekRange("2026-06-29"))).toEqual([
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
  });
  it("yields exactly the month's days for a midnight-aligned month", () => {
    const dates = serviceDatesInRange(nzMonthRange("2026-06"));
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe("2026-06-01");
    expect(dates[29]).toBe("2026-06-30");
  });
  it("keeps seven days ending on the anchor's service day for the rolling window", () => {
    // 2026-06-15 00:00 UTC == 15 Jun 12:00 NZST > service day 2026-06-15.
    expect(serviceDatesInRange(nzLast7DaysRange(new Date("2026-06-15T00:00:00Z")))).toEqual([
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
      "2026-06-15",
    ]);
  });
  it("rolls a pre-5am anchor back to the previous service day", () => {
    // 2026-06-14 15:00 UTC == 15 Jun 03:00 NZST > still service day 2026-06-14.
    const dates = serviceDatesInRange(nzLast7DaysRange(new Date("2026-06-14T15:00:00Z")));
    expect(dates).toHaveLength(7);
    expect(dates[6]).toBe("2026-06-14");
  });
  it("still yields seven days for weeks spanning the DST transitions", () => {
    // NZDT starts Sun 27 Sep 2026 and ends Sun 5 Apr 2026.
    expect(serviceDatesInRange(nzWeekRange("2026-09-21"))).toHaveLength(7);
    expect(serviceDatesInRange(nzWeekRange("2026-03-30"))).toHaveLength(7);
  });
});

describe("nzLast7DaysRange", () => {
  it("covers seven service days across the NZDT start", () => {
    // 2026-09-28 00:00 UTC == 28 Sep 13:00 NZDT; window spans the 27 Sep switch.
    const dates = serviceDatesInRange(nzLast7DaysRange(new Date("2026-09-28T00:00:00Z")));
    expect(dates).toEqual([
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
      "2026-09-28",
    ]);
  });
  it("covers seven service days across the NZDT end", () => {
    // 2026-04-07 00:00 UTC == 7 Apr 12:00 NZST; window spans the 5 Apr switch.
    const dates = serviceDatesInRange(nzLast7DaysRange(new Date("2026-04-07T00:00:00Z")));
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-04-01");
    expect(dates[6]).toBe("2026-04-07");
  });
});
