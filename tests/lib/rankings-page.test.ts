// tests/lib/rankings-page.test.ts
// The rankings windows are clamped to the archive floor while their labels keep
// naming the calendar period, so a partial first week reads as the week it is.
import { DATA_START_DAY, rangeIsEmpty } from "@/lib/data-start";
import { resolvePrevRange, resolveRange } from "@/lib/rankings-page";
import { nzServiceDayRange } from "@/lib/time";
import { describe, expect, it } from "vitest";

const anchor = new Date("2026-09-16T00:00:00Z");
const floor = nzServiceDayRange(DATA_START_DAY).start;

describe("resolveRange", () => {
  it("raises the first week to the floor but still labels the whole week", () => {
    const { range, label } = resolveRange("week", "2026-09-07", anchor);
    expect(range.start.toISOString()).toBe(floor.toISOString());
    expect(label).toBe("07/09 to 13/09");
  });
  it("raises the first month to the floor and labels the month", () => {
    const { range, label } = resolveRange("month", "2026-09", anchor);
    expect(range.start.toISOString()).toBe(floor.toISOString());
    expect(label).toBe("September 2026");
  });
  it("leaves a window that already starts after the floor alone", () => {
    const { range } = resolveRange("week", "2026-09-14", anchor);
    // Mon 14 Sep 2026 04:00 NZST, the week's first service day.
    expect(range.start.toISOString()).toBe("2026-09-13T16:00:00.000Z");
  });
});

describe("resolvePrevRange", () => {
  it("reports the week before the first week as an empty window", () => {
    expect(rangeIsEmpty(resolvePrevRange("week", "2026-09-14", anchor))).toBe(false);
    expect(rangeIsEmpty(resolvePrevRange("week", "2026-09-07", anchor))).toBe(true);
  });
  it("reports the month before the first month as an empty window", () => {
    expect(rangeIsEmpty(resolvePrevRange("month", "2026-09", anchor))).toBe(true);
  });
});
