import {
  mondayOf,
  monthPickPeriod,
  monthShort,
  monthTitle,
  monthWeeks,
  weekPickPeriod,
} from "@/lib/calendar";
import { describe, expect, it } from "vitest";

describe("mondayOf", () => {
  it("finds the week's Monday, a Monday being its own and a Sunday closing the week", () => {
    expect(mondayOf("2026-09-29")).toBe("2026-09-28");
    expect(mondayOf("2026-09-28")).toBe("2026-09-28");
    expect(mondayOf("2026-09-27")).toBe("2026-09-21");
  });
});

describe("monthWeeks", () => {
  it("covers the month in whole Monday-first weeks", () => {
    const weeks = monthWeeks("2026-09");
    // 1 Sep 2026 is a Tuesday and the 30th a Wednesday.
    expect(weeks[0]![0]).toBe("2026-08-31");
    expect(weeks.at(-1)![6]).toBe("2026-10-04");
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it("holds a month that starts on a Monday without a leading week", () => {
    // 1 Jun 2026 is a Monday.
    expect(monthWeeks("2026-06")[0]![0]).toBe("2026-06-01");
  });
});

describe("month labels", () => {
  it("names the month in full and short", () => {
    expect(monthTitle("2026-09")).toBe("September 2026");
    expect(monthShort("2026-09")).toBe("Sep");
  });
});

describe("pick periods", () => {
  const today = "2026-09-29";

  it("opens a past week on its Monday and this week, from its Monday on, on the rolling week", () => {
    expect(weekPickPeriod("2026-09-24", today)).toBe("2026-09-21");
    expect(weekPickPeriod("2026-09-28", today)).toBe("2026-09-28");
    expect(weekPickPeriod("2026-09-28", "2026-09-28")).toBeNull();
  });

  it("opens a past month by key and the current one on the default", () => {
    expect(monthPickPeriod("2026-08", today)).toBe("2026-08");
    expect(monthPickPeriod("2026-09", today)).toBeNull();
  });
});
