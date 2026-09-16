// src/lib/data-start.test.ts
// The archive floor: clamping a service date to it in both directions, and
// clamping a window without losing its first service day.
import {
  clampRangeToDataStart,
  clampServiceDate,
  DATA_START_DAY,
  DATA_START_LABEL,
  dataStartDate,
  isBeforeDataStart,
  rangeIsEmpty,
} from "@/lib/data-start";
import {
  nzServiceDayRange,
  nzServiceDayString,
  nzWeekRange,
  parseYmd,
  serviceDatesInRange,
} from "@/lib/time";
import { describe, expect, it } from "vitest";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

describe("clampServiceDate", () => {
  it("raises anything before the archive to its first day", () => {
    expect(clampServiceDate("2026-09-08")).toBe(DATA_START_DAY);
    expect(clampServiceDate("2020-01-01")).toBe(DATA_START_DAY);
  });
  it("lowers anything past today onto today, and leaves the middle alone", () => {
    expect(clampServiceDate("2027-01-01", "2026-09-16")).toBe("2026-09-16");
    expect(clampServiceDate("2026-09-12", "2026-09-16")).toBe("2026-09-12");
    expect(clampServiceDate("2026-09-16", "2026-09-16")).toBe("2026-09-16");
  });
  it("names the days on either side of the floor", () => {
    expect(isBeforeDataStart("2026-09-10")).toBe(true);
    expect(isBeforeDataStart(DATA_START_DAY)).toBe(false);
  });
});

describe("clampRangeToDataStart", () => {
  it("raises the first week's start to exactly the floor's own start", () => {
    const clamped = clampRangeToDataStart(nzWeekRange("2026-09-07"));
    expect(clamped.start.toISOString()).toBe(nzServiceDayRange(DATA_START_DAY).start.toISOString());
    // The exact match is load-bearing: one millisecond later and
    // serviceDatesInRange drops 11 September.
    expect(serviceDatesInRange(clamped)[0]).toBe(DATA_START_DAY);
  });
  it("leaves a week that already starts after the floor untouched", () => {
    const week = nzWeekRange("2026-09-14");
    expect(clampRangeToDataStart(week)).toBe(week);
  });
  it("reports a window entirely before the floor as empty", () => {
    expect(rangeIsEmpty(clampRangeToDataStart(nzWeekRange("2026-08-31")))).toBe(true);
    expect(rangeIsEmpty(nzWeekRange("2026-09-14"))).toBe(false);
  });
});

describe("dataStartDate", () => {
  it("sits inside the first service day", () => {
    expect(nzServiceDayString(dataStartDate())).toBe(DATA_START_DAY);
  });
});

describe("DATA_START_LABEL", () => {
  it("names the same day as DATA_START_DAY", () => {
    const { y, mo, d } = parseYmd(DATA_START_DAY);
    expect(DATA_START_LABEL).toBe(`${d} ${MONTH_NAMES[mo - 1]} ${y}`);
  });
});
