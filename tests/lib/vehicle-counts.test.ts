// tests/lib/vehicle-counts.test.ts
// Unit tests for the per-mode vehicle split and the distinct count across days.
import { type VehicleMode, countVehicles, vehiclesByMode } from "@/lib/vehicle-counts";
import { describe, expect, it } from "vitest";

const modes = new Map<string, VehicleMode>([
  ["NX1", "BUS"],
  ["70", "BUS"],
  ["STH", "TRAIN"],
  ["DEV", "FERRY"],
]);

describe("vehiclesByMode", () => {
  it("files each vehicle under its route's mode", () => {
    expect(
      vehiclesByMode(
        [
          { v: "3524", r: "NX1" },
          { v: "59131", r: "STH" },
          { v: "4011", r: "DEV" },
          { v: "3600", r: "70" },
        ],
        modes,
      ),
    ).toEqual({ BUS: ["3524", "3600"], TRAIN: ["59131"], FERRY: ["4011"] });
  });

  it("leaves out a vehicle on an unknown route", () => {
    expect(vehiclesByMode([{ v: "1", r: "GONE" }], modes)).toEqual({
      BUS: [],
      TRAIN: [],
      FERRY: [],
    });
  });
});

describe("countVehicles", () => {
  it("counts a vehicle seen on several days once", () => {
    expect(
      countVehicles([
        { BUS: ["1", "2"], TRAIN: ["9"], FERRY: [] },
        { BUS: ["2", "3"], TRAIN: ["9"], FERRY: ["7"] },
      ]),
    ).toEqual({ BUS: 3, TRAIN: 1, FERRY: 1 });
  });

  it("gives zeros for no days", () => {
    expect(countVehicles([])).toEqual({ BUS: 0, TRAIN: 0, FERRY: 0 });
  });
});
