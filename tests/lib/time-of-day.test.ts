// tests/lib/time-of-day.test.ts
// Unit tests for the `hours` param: parsing, the wrap past midnight, and the
// rule that the presets partition the service day.
import {
  activePreset,
  hourRangeLabel,
  hourRangeParam,
  hoursInRange,
  isHourInRange,
  parseHourRange,
  TIME_PRESETS,
} from "@/lib/time-of-day";
import { describe, expect, it } from "vitest";

describe("parseHourRange", () => {
  it("reads a range", () => {
    expect(parseHourRange("7-9")).toEqual({ from: 7, to: 9 });
    expect(parseHourRange("18-4")).toEqual({ from: 18, to: 4 });
    expect(parseHourRange("0-23")).toEqual({ from: 0, to: 23 });
  });

  it("treats anything unreadable as all day", () => {
    for (const raw of [
      undefined,
      "",
      "7",
      "7-9-11",
      "seven-nine",
      "-9",
      "7-",
      "24-2",
      "-1-5",
      "7.5-9",
      "9-9",
    ]) {
      expect(parseHourRange(raw)).toBeNull();
    }
  });

  it("round-trips through the param", () => {
    for (const preset of TIME_PRESETS) {
      expect(parseHourRange(hourRangeParam(preset.range))).toEqual(preset.range);
    }
    expect(hourRangeParam(null)).toBeUndefined();
  });
});

describe("isHourInRange", () => {
  it("covers from inclusive to to exclusive", () => {
    const morning = { from: 7, to: 9 };
    expect(isHourInRange(6, morning)).toBe(false);
    expect(isHourInRange(7, morning)).toBe(true);
    expect(isHourInRange(8, morning)).toBe(true);
    expect(isHourInRange(9, morning)).toBe(false);
  });

  it("wraps past midnight", () => {
    const night = { from: 22, to: 2 };
    expect(isHourInRange(21, night)).toBe(false);
    expect(isHourInRange(22, night)).toBe(true);
    expect(isHourInRange(0, night)).toBe(true);
    expect(isHourInRange(1, night)).toBe(true);
    expect(isHourInRange(2, night)).toBe(false);
  });
});

describe("hoursInRange", () => {
  it("lists a plain range ascending", () => {
    expect(hoursInRange({ from: 9, to: 15 })).toEqual([9, 10, 11, 12, 13, 14]);
  });

  it("lists a wrapping range evening first", () => {
    expect(hoursInRange({ from: 22, to: 2 })).toEqual([22, 23, 0, 1]);
  });

  it("agrees with the predicate on every hour", () => {
    for (const range of [
      { from: 7, to: 9 },
      { from: 18, to: 4 },
      { from: 0, to: 23 },
    ]) {
      const listed = new Set(hoursInRange(range));
      for (let h = 0; h < 24; h++) {
        expect(listed.has(h)).toBe(isHourInRange(h, range));
      }
    }
  });
});

describe("TIME_PRESETS", () => {
  it("partitions the service day exactly once", () => {
    // Every hour belongs to one preset and no hour to two, so stepping along
    // the chips shows every arrival exactly once.
    const counts = new Map<number, number>();
    for (const preset of TIME_PRESETS) {
      for (const h of hoursInRange(preset.range)) {
        counts.set(h, (counts.get(h) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(24);
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
  });

  it("starts at the service day's 4am boundary", () => {
    expect(TIME_PRESETS[0]?.range.from).toBe(4);
    expect(TIME_PRESETS.at(-1)?.range.to).toBe(4);
  });
});

describe("hourRangeLabel", () => {
  it("names a preset and spells out anything else", () => {
    expect(hourRangeLabel(null)).toBe("All day");
    expect(hourRangeLabel({ from: 7, to: 9 })).toBe("Morning peak");
    expect(hourRangeLabel({ from: 22, to: 2 })).toBe("10pm to 2am");
    expect(hourRangeLabel({ from: 0, to: 12 })).toBe("12am to 12pm");
  });

  it("recognises a preset only on an exact match", () => {
    expect(activePreset({ from: 7, to: 9 })?.key).toBe("am-peak");
    expect(activePreset({ from: 7, to: 10 })).toBeNull();
    expect(activePreset(null)).toBeNull();
  });
});
