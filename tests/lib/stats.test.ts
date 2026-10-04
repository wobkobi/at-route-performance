// tests/lib/stats.test.ts
// Unit tests for the shared rounding and weighted-mean helpers.

import { roundTenth, weightedMean } from "@/lib/stats";
import { describe, expect, it } from "vitest";

describe("roundTenth", () => {
  it("rounds to one decimal place", () => {
    expect(roundTenth(12.34)).toBe(12.3);
    expect(roundTenth(12.35)).toBe(12.4);
    expect(roundTenth(-3.06)).toBe(-3.1);
  });
});

describe("weightedMean", () => {
  /**
   * A row's weight.
   * @param r - The row.
   * @param r.e - Its arrivals.
   * @returns The weight.
   */
  const events = (r: { e: number }): number => r.e;

  it("weights each row", () => {
    const rows = [
      { v: 60, e: 900 },
      { v: 100, e: 100 },
    ];
    expect(weightedMean(rows, (r) => r.v, events)).toBe(64);
  });

  it("skips a null figure in both the sum and the divisor", () => {
    const rows = [
      { v: 80, e: 100 },
      { v: null, e: 100 },
    ];
    expect(weightedMean(rows, (r) => r.v, events)).toBe(80);
  });

  it("is null when nothing carries weight", () => {
    expect(weightedMean([], (r: { v: number; e: number }) => r.v, events)).toBeNull();
    expect(weightedMean([{ v: 5, e: 0 }], (r) => r.v, events)).toBeNull();
    expect(weightedMean([{ v: null, e: 10 }], (r) => r.v, events)).toBeNull();
  });
});
