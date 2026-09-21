// tests/lib/vehicle-status.test.ts
// Unit tests for the live vehicle delay verdict.
import { vehicleStatus } from "@/lib/vehicle-status";
import { describe, expect, it } from "vitest";

describe("vehicleStatus", () => {
  it("keeps a bus three minutes late on time, and says how late", () => {
    expect(vehicleStatus(180, "BUS")).toEqual({
      band: "ontime",
      label: null,
      detail: "3m late, inside the on-time window",
    });
  });

  it("labels a vehicle outside the window with the same words as its popup", () => {
    const late = vehicleStatus(301, "BUS");
    expect(late).toEqual({ band: "late", label: "5m 1s late", detail: "5m 1s late" });
    expect(vehicleStatus(-61, "BUS")).toMatchObject({ band: "early", label: "1m 1s early" });
  });

  it("uses the mode's own early tolerance", () => {
    // A ferry may leave early by more than a bus before it counts as early.
    expect(vehicleStatus(-90, "BUS").band).toBe("early");
    expect(vehicleStatus(-90, "FERRY").band).toBe("ontime");
  });

  it("tells no data apart from on time", () => {
    expect(vehicleStatus(null, "BUS")).toEqual({
      band: "unknown",
      label: null,
      detail: "No live delay",
    });
    expect(vehicleStatus(0, "BUS").detail).toBe("On time");
  });
});
