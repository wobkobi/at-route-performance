// src/lib/time.test.ts
// Unit tests for the Auckland-timezone day, week and month range helpers in time.ts.
import {
  monthRangeLabel,
  NZ_TZ,
  nzDayRange,
  nzLast7DaysRange,
  nzMonthKey,
  nzMonthRange,
  nzServiceDayRange,
  nzServiceDayString,
  nzWeekRange,
  nzWeekStart,
  SERVICE_START_HOUR,
  serviceDatesInRange,
  serviceDayClockInstant,
  serviceDayNoon,
  shiftMonth,
  weekdayShort,
} from "@/lib/time";
import { describe, expect, it } from "vitest";

const HOUR_MS = 3_600_000;

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

describe("Auckland midnight on DST-switch days", () => {
  // The switch happens at 02:00/03:00 local, so local midnight sits on the
  // old offset while UTC midnight (local noon) already sits on the new one. A
  // single offset sample at UTC midnight put these days an hour off.
  it("starts the NZDT-start day (27 Sep 2026) at NZST midnight and makes it 23 hours long", () => {
    // 2026-09-27 05:00 UTC == 27 Sep 18:00 NZDT, comfortably inside the day.
    const { start, end } = nzDayRange(new Date("2026-09-27T05:00:00Z"));
    expect(start.toISOString()).toBe("2026-09-26T12:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-27T11:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(23 * HOUR_MS);
  });
  it("starts the NZDT-end day (5 Apr 2026) at NZDT midnight and makes it 25 hours long", () => {
    const { start, end } = nzDayRange(new Date("2026-04-05T05:00:00Z"));
    expect(start.toISOString()).toBe("2026-04-04T11:00:00.000Z");
    expect(end.toISOString()).toBe("2026-04-05T12:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(25 * HOUR_MS);
  });
  it("ends the week containing the switch at the following Monday's NZDT midnight", () => {
    // Mon 28 Sep 2026 00:00 NZDT == 2026-09-27T11:00Z; the week is 167 hours.
    const { start, end } = nzWeekRange("2026-09-21");
    expect(end.toISOString()).toBe("2026-09-27T11:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(167 * HOUR_MS);
  });
  it("starts a month whose 1st is a switch Sunday at the right midnight", () => {
    // 1 Apr 2029 is a Sunday, so NZDT ends that morning; midnight is still NZDT.
    expect(nzMonthRange("2029-04").start.toISOString()).toBe("2029-03-31T11:00:00.000Z");
  });
  it("keeps the 4am service-day boundary correct on both switch days", () => {
    // 04:00 is after the 02:00/03:00 switch, so the switch day's own boundary
    // already carries the new offset: NZDT on 27 Sep, NZST on 5 Apr.
    expect(nzServiceDayRange("2026-09-27").start.toISOString()).toBe("2026-09-26T15:00:00.000Z");
    expect(nzServiceDayRange("2026-09-28").start.toISOString()).toBe("2026-09-27T15:00:00.000Z");
    expect(nzServiceDayRange("2026-04-05").start.toISOString()).toBe("2026-04-04T16:00:00.000Z");
    expect(nzServiceDayRange("2026-04-06").start.toISOString()).toBe("2026-04-05T16:00:00.000Z");
  });

  it("spans 23 hours into NZDT and 25 hours out of it", () => {
    const spring = nzServiceDayRange("2026-09-26");
    expect(spring.start.toISOString()).toBe("2026-09-25T16:00:00.000Z");
    expect(spring.end.toISOString()).toBe("2026-09-26T15:00:00.000Z");
    const autumn = nzServiceDayRange("2027-04-03");
    expect(autumn.start.toISOString()).toBe("2027-04-02T15:00:00.000Z");
    expect(autumn.end.toISOString()).toBe("2027-04-03T16:00:00.000Z");
  });

  it("labels the boundary instant and the minute before it", () => {
    expect(nzServiceDayString(new Date("2026-09-14T16:00:00Z"))).toBe("2026-09-15");
    expect(nzServiceDayString(new Date("2026-09-14T15:59:59.999Z"))).toBe("2026-09-14");
    // The 04:59 case that moves: it used to fall on 14 September.
    expect(nzServiceDayString(new Date("2026-09-14T16:59:00Z"))).toBe("2026-09-15");
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

describe("serviceDayClockInstant", () => {
  const sep13 = nzServiceDayRange("2026-09-13").start; // 4am NZST = 2026-09-12T16:00Z
  /**
   * The instant of an hour:minute schedule time on the 13 September service day.
   * @param hm - Hours (may exceed 23) and minutes.
   * @returns The ISO instant.
   */
  const at = (hm: [number, number]): string =>
    serviceDayClockInstant(sep13, hm[0] * 3600 + hm[1] * 60).toISOString();

  it("places a daytime start on the service date", () => {
    expect(at([7, 30])).toBe("2026-09-12T19:30:00.000Z");
  });
  it("reads an extended time and its next-date form as the same post-midnight run", () => {
    expect(at([24, 30])).toBe("2026-09-13T12:30:00.000Z");
    expect(at([0, 30])).toBe("2026-09-13T12:30:00.000Z");
  });
  it("matches GTFS noon-minus-12h on the NZDT-start day", () => {
    // 27 Sep 2026 skips 02:00-03:00; 7am NZDT (+13) is 18:00Z the day before.
    const sep27 = nzServiceDayRange("2026-09-27").start;
    expect(serviceDayClockInstant(sep27, 7 * 3600).toISOString()).toBe("2026-09-26T18:00:00.000Z");
  });
  it("keeps an 04:45 start on its own date and a 03:55 one on the day before", () => {
    const sep15 = nzServiceDayRange("2026-09-15").start;
    expect(serviceDayClockInstant(sep15, 4 * 3600 + 45 * 60).toISOString()).toBe(
      "2026-09-14T16:45:00.000Z",
    );
    expect(serviceDayClockInstant(sep15, 3 * 3600 + 55 * 60).toISOString()).toBe(
      "2026-09-15T15:55:00.000Z",
    );
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
  it("rolls a pre-4am anchor back to the previous service day", () => {
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

describe("month helpers", () => {
  it("shiftMonth steps across year boundaries in both directions", () => {
    expect(shiftMonth("2026-06", 1)).toBe("2026-07");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-06", -18)).toBe("2024-12");
  });
  it("nzMonthKey labels an instant with its Auckland month", () => {
    // 2026-06-30 13:00 UTC == 1 Jul 01:00 NZST.
    expect(nzMonthKey(new Date("2026-06-30T13:00:00Z"))).toBe("2026-07");
  });
  it("monthRangeLabel names the month of the range", () => {
    expect(monthRangeLabel(nzMonthRange("2026-06"))).toBe("June 2026");
  });
});

describe("weekdayShort", () => {
  it("labels dates with the weekday of the date itself", () => {
    expect(weekdayShort("2026-06-29")).toBe("Mon");
    expect(weekdayShort("2026-07-05")).toBe("Sun");
    // NZDT-season date and the DST-transition day itself.
    expect(weekdayShort("2026-01-15")).toBe("Thu");
    expect(weekdayShort("2026-09-27")).toBe("Sun");
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

describe("serviceDayNoon", () => {
  /**
   * The Auckland-local wall-clock hour of an instant.
   * @param at - The instant.
   * @returns The local hour, 0-23.
   */
  function nzHour(at: Date): number {
    return Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: NZ_TZ,
        hour: "2-digit",
        hour12: false,
      }).format(at),
    );
  }

  it("is exactly noon on both sides of the April switch", () => {
    // NZDT ends 5 April 2026 at 03:00 > 02:00. Noon is after the switch on the
    // day itself, so 5 and 6 April read UTC+12 while 3 and 4 April read UTC+13.
    expect(serviceDayNoon("2026-04-03").toISOString()).toBe("2026-04-02T23:00:00.000Z");
    expect(serviceDayNoon("2026-04-04").toISOString()).toBe("2026-04-03T23:00:00.000Z");
    expect(serviceDayNoon("2026-04-05").toISOString()).toBe("2026-04-05T00:00:00.000Z");
    expect(serviceDayNoon("2026-04-06").toISOString()).toBe("2026-04-06T00:00:00.000Z");
  });

  it("is exactly noon on both sides of the September switch", () => {
    // NZDT starts 27 September 2026 at 02:00 > 03:00; noon on the 27th is after it.
    expect(serviceDayNoon("2026-09-25").toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(serviceDayNoon("2026-09-26").toISOString()).toBe("2026-09-26T00:00:00.000Z");
    expect(serviceDayNoon("2026-09-27").toISOString()).toBe("2026-09-26T23:00:00.000Z");
    expect(serviceDayNoon("2026-09-28").toISOString()).toBe("2026-09-27T23:00:00.000Z");
  });

  it("reads noon on the wall clock, not a fixed offset from the day's start", () => {
    for (const day of ["2026-04-05", "2026-06-15", "2026-09-27", "2026-12-25"]) {
      expect(nzHour(serviceDayNoon(day))).toBe(12);
    }
  });

  it("lands inside the service day whatever the start hour", () => {
    // The marker must not depend on SERVICE_START_HOUR: it is noon, so it sits
    // inside the day for every plausible boundary, before and after the move to 4.
    for (const startHour of [1, 2, 3, 4, 5, 6]) {
      expect(nzServiceDayString(serviceDayNoon("2026-09-27"), startHour)).toBe("2026-09-27");
      expect(nzServiceDayString(serviceDayNoon("2026-04-05"), startHour)).toBe("2026-04-05");
    }
    expect(nzServiceDayString(serviceDayNoon("2026-09-11"), SERVICE_START_HOUR)).toBe("2026-09-11");
  });
});
