// tests/lib/on-time.test.ts
// Unit tests for the on-time window and delay banding.
import {
  delayBand,
  earlyToleranceFor,
  isConsistentlyLateOrEarly,
  isOnTime,
  ON_TIME_LATE_SEC,
} from "@/lib/on-time";
import { describe, expect, it } from "vitest";

describe("the on-time window", () => {
  it("allows up to five minutes late for every mode", () => {
    for (const mode of ["BUS", "TRAIN", "FERRY"]) {
      expect(isOnTime(ON_TIME_LATE_SEC, mode)).toBe(true);
      expect(isOnTime(ON_TIME_LATE_SEC + 1, mode)).toBe(false);
    }
  });

  it("gives buses and trains one minute early and ferries five", () => {
    expect(earlyToleranceFor("BUS")).toBe(60);
    expect(earlyToleranceFor("TRAIN")).toBe(60);
    expect(earlyToleranceFor("FERRY")).toBe(ON_TIME_LATE_SEC);
    expect(isOnTime(-60, "BUS")).toBe(true);
    expect(isOnTime(-61, "BUS")).toBe(false);
    expect(isOnTime(-300, "FERRY")).toBe(true);
    expect(isOnTime(-301, "FERRY")).toBe(false);
  });

  it("treats an unknown mode like a bus", () => {
    expect(earlyToleranceFor("HOVERCRAFT")).toBe(60);
    expect(isOnTime(-90, "HOVERCRAFT")).toBe(false);
  });
});

describe("delayBand", () => {
  it("rounds before banding so the colour matches the displayed delay", () => {
    expect(delayBand(300.4, "BUS")).toBe("ontime");
    expect(delayBand(300.6, "BUS")).toBe("late");
    expect(delayBand(-60.4, "TRAIN")).toBe("ontime");
    expect(delayBand(-60.6, "TRAIN")).toBe("early");
  });
});

describe("isConsistentlyLateOrEarly", () => {
  it("is true when the signed and absolute averages agree once rounded", () => {
    expect(isConsistentlyLateOrEarly(180.2, 180.4)).toBe(true);
    expect(isConsistentlyLateOrEarly(-90, 90)).toBe(true);
    expect(isConsistentlyLateOrEarly(10, 240)).toBe(false);
  });
});
