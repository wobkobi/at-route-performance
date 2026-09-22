// tests/lib/vehicle-detail.test.ts
// Unit tests for the vehicle page's pure helpers.
import {
  VEHICLE_ID,
  occupancyLabel,
  runFigures,
  vehicleName,
  vehicleRank,
} from "@/lib/vehicle-detail";
import type { VehicleTotal } from "@/lib/vehicle-rank";
import { describe, expect, it } from "vitest";

describe("occupancyLabel", () => {
  it("names each status the feed sends", () => {
    expect(occupancyLabel(0)).toBe("Empty");
    expect(occupancyLabel(1)).toBe("Plenty of seats");
    expect(occupancyLabel(3)).toBe("Standing room only");
  });

  it("reads missing or unknown as nothing", () => {
    expect(occupancyLabel(null)).toBeNull();
    expect(occupancyLabel(9)).toBeNull();
    expect(occupancyLabel(1.5)).toBeNull();
  });
});

describe("vehicleName", () => {
  it("prefers the fleet label", () => {
    expect(vehicleName("RT7206", "47206")).toBe("RT7206");
  });

  it("falls back to the feed id", () => {
    expect(vehicleName(null, "47206")).toBe("Vehicle 47206");
    expect(vehicleName("  ", "47206")).toBe("Vehicle 47206");
  });
});

describe("vehicleRank", () => {
  const board = ["a", "b", "c"].map((vehicleId) => ({ vehicleId }) as VehicleTotal);

  it("gives a 1-based rank and the board size", () => {
    expect(vehicleRank(board, "b")).toEqual({ rank: 2, of: 3 });
  });

  it("is null off the board", () => {
    expect(vehicleRank(board, "z")).toBeNull();
  });
});

describe("runFigures", () => {
  it("averages the sums and times the run", () => {
    expect(
      runFigures({
        tripId: "t",
        routeId: "r",
        startMs: 0,
        firstMs: 1_000,
        lastMs: 3_601_000,
        e: 4,
        dev: -120,
        abs: 200,
        cars: null,
      }),
    ).toEqual({ avgSec: -30, avgAbsSec: 50, durationSec: 3600 });
  });

  it("survives a run with no arrivals", () => {
    const f = runFigures({
      tripId: "t",
      routeId: "r",
      startMs: 0,
      firstMs: 0,
      lastMs: 0,
      e: 0,
      dev: 0,
      abs: 0,
      cars: null,
    });
    expect(f.avgSec).toBe(0);
  });
});

describe("VEHICLE_ID", () => {
  it("takes feed ids only", () => {
    expect(VEHICLE_ID.test("47206")).toBe(true);
    expect(VEHICLE_ID.test("RT7206")).toBe(false);
    expect(VEHICLE_ID.test("")).toBe(false);
  });
});
