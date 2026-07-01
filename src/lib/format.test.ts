// src/lib/format.test.ts
/**
 * @description Unit tests for the delay and duration formatting helpers in format.ts.
 */
import { formatDelay } from "@/lib/format";
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
