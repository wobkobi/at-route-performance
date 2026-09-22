// tests/lib/vehicle-rank.test.ts
// Unit tests for merging per-day vehicle work and ranking the result.
import {
  type VehicleDayRow,
  mergeVehicleDays,
  parseVehicleSort,
  sortVehicles,
} from "@/lib/vehicle-rank";
import { describe, expect, it } from "vitest";

/**
 * A day row with defaults, overridden per test.
 * @param over - The fields a test sets.
 * @returns The row.
 */
const row = (over: Partial<VehicleDayRow> & { v: string }): VehicleDayRow => ({
  m: "BUS",
  r: 1,
  s: 3600,
  e: 10,
  a: 600,
  routes: ["70"],
  ...over,
});

describe("mergeVehicleDays", () => {
  it("sums a vehicle's days and counts them", () => {
    const [t] = mergeVehicleDays([
      [row({ v: "1", r: 5, s: 36_000, e: 100, a: 6_000, routes: ["70"] })],
      [row({ v: "1", r: 3, s: 18_000, e: 50, a: 9_000, routes: ["NX1", "70"] })],
    ]);
    expect(t).toEqual({
      vehicleId: "1",
      mode: "BUS",
      runs: 8,
      serviceSec: 54_000,
      arrivals: 150,
      avgOffSec: 100,
      routes: ["70", "NX1"],
      days: 2,
    });
  });

  it("weights the average by arrivals, not by day", () => {
    const [t] = mergeVehicleDays([
      [row({ v: "1", e: 90, a: 0 })],
      [row({ v: "1", e: 10, a: 1_000 })],
    ]);
    expect(t?.avgOffSec).toBe(10);
  });

  it("keeps vehicles apart", () => {
    expect(mergeVehicleDays([[row({ v: "1" }), row({ v: "2" })]])).toHaveLength(2);
  });
});

describe("sortVehicles", () => {
  const list = mergeVehicleDays([
    [
      row({ v: "a", r: 9, s: 1_000, e: 5, a: 500 }),
      row({ v: "b", r: 2, s: 9_000, e: 50, a: 50 }),
      row({ v: "c", r: 2, s: 9_000, e: 20, a: 20 }),
    ],
  ]);

  it("ranks by time in service by default, ties to the id", () => {
    expect(sortVehicles(list, "hours").map((t) => t.vehicleId)).toEqual(["b", "c", "a"]);
  });

  it("ranks by runs", () => {
    expect(sortVehicles(list, "runs")[0]?.vehicleId).toBe("a");
  });

  it("ranks by average off schedule", () => {
    expect(sortVehicles(list, "off")[0]?.vehicleId).toBe("a");
  });
});

describe("parseVehicleSort", () => {
  it("falls back to hours", () => {
    expect(parseVehicleSort("bogus")).toBe("hours");
    expect(parseVehicleSort("runs")).toBe("runs");
  });
});
