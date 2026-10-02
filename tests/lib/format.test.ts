// tests/lib/format.test.ts
// Unit tests for the count, percentage, delay and duration helpers in format.ts.

import {
  barPct,
  formatCount,
  formatDelay,
  formatDuration,
  formatPct,
  midSentence,
  offScheduleValue,
  plural,
  sentenceStart,
  UNKNOWN_VALUE,
} from "@/lib/format";
import { formatGtfsTime, nzClockTime } from "@/lib/time/format";
import { describe, expect, it } from "vitest";

describe("formatDelay", () => {
  it("formats whole minutes + seconds late", () => {
    expect(formatDelay(378)).toBe("6m 18s late");
  });
  it("formats early (negative) values", () => {
    expect(formatDelay(-220)).toBe("3m 40s early");
  });
  it("drops a zero seconds component", () => {
    expect(formatDelay(180)).toBe("3m late");
  });
  it("drops the minutes component under a minute", () => {
    expect(formatDelay(45)).toBe("45s late");
    expect(formatDelay(-9)).toBe("9s early");
  });
  it("returns 'on time' at exactly zero", () => {
    expect(formatDelay(0)).toBe("on time");
  });
  it("treats anything within threshold as on time", () => {
    expect(formatDelay(120, { thresholdSec: 300 })).toBe("on time");
    expect(formatDelay(-300, { thresholdSec: 300 })).toBe("on time");
  });
  it("rounds fractional seconds (no decimals)", () => {
    expect(formatDelay(90.7)).toBe("1m 31s late");
  });
});

describe("non-finite guards", () => {
  it("renders NaN and infinities as the unknown dash instead of wording them", () => {
    expect(formatDelay(Number.NaN)).toBe(UNKNOWN_VALUE);
    expect(formatDelay(Number.POSITIVE_INFINITY, { mode: "BUS" })).toBe(UNKNOWN_VALUE);
    expect(formatDuration(Number.NaN)).toBe(UNKNOWN_VALUE);
    expect(formatDuration(Number.NEGATIVE_INFINITY)).toBe(UNKNOWN_VALUE);
  });
  it("still words a finite value", () => {
    expect(formatDuration(75)).toBe("1m 15s");
    expect(formatDelay(-60, { mode: "BUS" })).toBe("on time");
  });
});

describe("offScheduleValue", () => {
  it("names the distance of a run inside the on-time window", () => {
    expect(offScheduleValue(120, 120, "BUS")).toEqual({ text: "2m late", tone: "ontime" });
    expect(offScheduleValue(-120, 120, "FERRY")).toEqual({ text: "2m early", tone: "ontime" });
  });

  it("carries the direction outside the window", () => {
    expect(offScheduleValue(400, 400, "BUS")).toEqual({ text: "6m 40s late", tone: "late" });
    expect(offScheduleValue(-90, 90, "BUS")).toEqual({ text: "1m 30s early", tone: "early" });
  });

  it("shows only the magnitude when early and late cancel out", () => {
    expect(offScheduleValue(30, 310, "BUS")).toEqual({ text: "5m 10s off", tone: "mixed" });
    expect(offScheduleValue(null, 200, "BUS")).toEqual({ text: "3m 20s off", tone: "mixed" });
  });

  it("falls back to the signed magnitude when the absolute average is missing", () => {
    expect(offScheduleValue(200, null, "BUS")).toEqual({ text: "3m 20s late", tone: "ontime" });
  });

  it("colours on the rounded value, so one printed figure has one colour", () => {
    // Both sides of the 300s boundary round to the same text, so they must not
    // read as two different verdicts - and must match delayBand's pin colour.
    expect(offScheduleValue(299.6, 299.6, "BUS")).toEqual({ text: "5m late", tone: "ontime" });
    expect(offScheduleValue(300.4, 300.4, "BUS")).toEqual({ text: "5m late", tone: "ontime" });
    expect(offScheduleValue(300.6, 300.6, "BUS")).toEqual({ text: "5m 1s late", tone: "late" });
  });

  it("reads on time only at exactly zero, and a dash with no figures", () => {
    expect(offScheduleValue(0, 0, "BUS")).toEqual({ text: "on time", tone: "ontime" });
    expect(offScheduleValue(null, null, "BUS")).toEqual({ text: UNKNOWN_VALUE, tone: "none" });
  });
});

describe("formatGtfsTime", () => {
  it("spaces the suffix like the en-NZ clock times", () => {
    expect(formatGtfsTime("12:49:00")).toBe("12:49 pm");
    expect(formatGtfsTime("00:05:00")).toBe("12:05 am");
  });

  it("wraps extended GTFS hours onto the next morning", () => {
    expect(formatGtfsTime("25:30:00")).toBe("1:30 am");
  });

  it("returns null for a missing or malformed time", () => {
    expect(formatGtfsTime(null)).toBeNull();
    expect(formatGtfsTime("nope")).toBeNull();
  });
});

describe("formatCount", () => {
  it("groups thousands the NZ way", () => {
    expect(formatCount(12345)).toBe("12,345");
    expect(formatCount(7)).toBe("7");
  });
});

describe("plural", () => {
  it("keeps the singular only for exactly one", () => {
    expect(plural(1, "trip")).toBe("1 trip");
    expect(plural(0, "trip")).toBe("0 trips");
    expect(plural(1234, "arrival")).toBe("1,234 arrivals");
  });
  it("takes an irregular plural", () => {
    expect(plural(2, "entry", "entries")).toBe("2 entries");
  });
});

describe("formatPct", () => {
  it("prints one decimal place", () => {
    expect(formatPct(85)).toBe("85.0%");
    expect(formatPct(12.345)).toBe("12.3%");
  });
  it("gives the unknown dash for a missing or non-finite share", () => {
    expect(formatPct(null)).toBe(UNKNOWN_VALUE);
    expect(formatPct(undefined)).toBe(UNKNOWN_VALUE);
    expect(formatPct(Number.NaN)).toBe(UNKNOWN_VALUE);
  });
});

describe("barPct", () => {
  it("clamps to the track", () => {
    expect(barPct(140)).toBe(100);
    expect(barPct(-5)).toBe(0);
    expect(barPct(null)).toBe(0);
  });
  it("keeps a floor so a sliver stays visible", () => {
    expect(barPct(0.5, 2)).toBe(2);
    expect(barPct(50, 2)).toBe(50);
  });
});

describe("formatGtfsTime beside nzClockTime", () => {
  it("spells a schedule time exactly as the recorded clock time", () => {
    // 21:05 UTC on 20 Sep is 9:05 am on 21 Sep in Auckland (NZST).
    expect(formatGtfsTime("09:05:00")).toBe(nzClockTime("2026-09-20T21:05:00Z"));
    expect(formatGtfsTime("21:40:00")).toBe(nzClockTime("2026-09-21T09:40:00Z"));
  });
});

describe("midSentence and sentenceStart", () => {
  it("change only the first letter", () => {
    expect(midSentence("To Britomart")).toBe("to Britomart");
    expect(sentenceStart("to Britomart via Panmure")).toBe("To Britomart via Panmure");
    expect(sentenceStart("")).toBe("");
  });
});
