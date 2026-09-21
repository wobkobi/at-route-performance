// src/lib/format.test.ts
// Unit tests for the delay and duration formatting helpers in format.ts.

import {
  formatDelay,
  formatDuration,
  formatGtfsTime,
  offScheduleValue,
  UNKNOWN_VALUE,
} from "@/lib/format";
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

  it("reads on time only at exactly zero, and a dash with no figures", () => {
    expect(offScheduleValue(0, 0, "BUS")).toEqual({ text: "on time", tone: "ontime" });
    expect(offScheduleValue(null, null, "BUS")).toEqual({ text: UNKNOWN_VALUE, tone: "unknown" });
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
