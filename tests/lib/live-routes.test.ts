// tests/lib/live-routes.test.ts
// Unit tests for the fold of the live vehicle feed into routes running now.
import { liveRouteSlugs, liveRoutes, liveTotals, parseLiveSort } from "@/lib/live-routes";
import type { LiveVehicle } from "@/lib/vehicles";
import { describe, expect, it } from "vitest";

/**
 * A live vehicle with only the fields the fold reads set.
 * @param routeId - Its route id.
 * @param delaySec - Its delay, or null.
 * @param tripId - Its trip, or null for a vehicle between runs.
 * @returns The vehicle.
 */
function veh(routeId: string, delaySec: number | null, tripId: string | null = "t"): LiveVehicle {
  return {
    vehicleId: Math.random().toString(),
    label: null,
    routeId,
    tripId,
    lat: -36.85,
    lon: 174.76,
    delaySec,
    bearing: null,
    directionId: null,
    cars: null,
    plate: null,
    occupancy: null,
    speedKmh: null,
    odometerKm: null,
    seenAt: null,
  };
}

const modes = new Map([
  ["NX1-202409", "BUS"],
  ["NX1-202410", "BUS"],
  ["WSTH-201", "TRAIN"],
  ["HOBS-201", "FERRY"],
]);

describe("liveRoutes", () => {
  it("folds route versions onto one slug and bands each vehicle", () => {
    const rows = liveRoutes(
      [
        veh("NX1-202409", 400),
        veh("NX1-202410", 10),
        veh("NX1-202409", -120),
        veh("NX1-202409", null),
      ],
      modes,
    );
    expect(rows).toEqual([
      {
        slug: "NX1",
        mode: "BUS",
        vehicles: 4,
        late: 1,
        onTime: 1,
        early: 1,
        unknown: 1,
        avgDelaySec: (400 + 10 - 120) / 3,
      },
    ]);
  });

  it("leaves out vehicles between runs", () => {
    expect(liveRoutes([veh("NX1-202409", 0, null)], modes)).toEqual([]);
    expect(liveRouteSlugs([veh("NX1-202409", 0, null), veh("WSTH-201", 0)])).toEqual(["WSTH"]);
  });

  it("uses the route's mode for the early tolerance", () => {
    // 90s early is early for a bus, inside the window for a ferry.
    const [ferry] = liveRoutes([veh("HOBS-201", -90)], modes);
    expect(ferry).toMatchObject({ mode: "FERRY", onTime: 1, early: 0 });
  });

  it("sorts by vehicles running, or by vehicles late", () => {
    const feed = [veh("NX1-202409", 0), veh("NX1-202409", 0), veh("WSTH-201", 600)];
    expect(liveRoutes(feed, modes).map((r) => r.slug)).toEqual(["NX1", "WSTH"]);
    expect(liveRoutes(feed, modes, "late").map((r) => r.slug)).toEqual(["WSTH", "NX1"]);
  });

  it("has no average when no vehicle carries a delay", () => {
    expect(liveRoutes([veh("WSTH-201", null)], modes)[0]?.avgDelaySec).toBeNull();
  });
});

describe("liveTotals", () => {
  it("adds up every row", () => {
    const rows = liveRoutes(
      [veh("NX1-202409", 400), veh("WSTH-201", 0), veh("WSTH-201", null)],
      modes,
    );
    expect(liveTotals(rows)).toEqual({
      routes: 2,
      vehicles: 3,
      late: 1,
      onTime: 1,
      early: 0,
      unknown: 1,
    });
  });
});

describe("parseLiveSort", () => {
  it("defaults to vehicles running", () => {
    expect(parseLiveSort(undefined)).toBe("running");
    expect(parseLiveSort("bogus")).toBe("running");
    expect(parseLiveSort("late")).toBe("late");
  });
});
