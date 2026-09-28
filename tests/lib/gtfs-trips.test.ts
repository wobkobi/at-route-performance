// tests/lib/gtfs-trips.test.ts
// Tests the API top-up for routes the GTFS zip leaves out.
import { fetchAll } from "@/lib/at-static";
import { fetchRouteTrips, routesMissingFromZip, type TripRecord } from "@/lib/gtfs-trips";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/at-static", () => ({ fetchAll: vi.fn() }));

const mockFetchAll = vi.mocked(fetchAll);

/**
 * Build a zip trip on a route.
 * @param routeId - The trip's route.
 * @returns A TripRecord.
 */
function zipTrip(routeId: string): TripRecord {
  return { id: `${routeId}-t`, routeId, headsign: null, directionId: 0, shapeId: null };
}

afterEach(() => {
  mockFetchAll.mockReset();
});

describe("routesMissingFromZip", () => {
  it("returns the listed routes with no zip trip, once each, in order", () => {
    const zip = [zipTrip("70-203"), zipTrip("NX1-203")];
    expect(routesMissingFromZip(zip, ["S454-203", "70-203", "S001-203", "S454-203"])).toEqual([
      "S454-203",
      "S001-203",
    ]);
  });

  it("returns nothing when the zip covers every route", () => {
    expect(routesMissingFromZip([zipTrip("70-203")], ["70-203"])).toEqual([]);
  });
});

describe("fetchRouteTrips", () => {
  it("maps each route's API trips onto that route", async () => {
    mockFetchAll.mockResolvedValueOnce([
      {
        trip_id: "1246-45451-28200-2-98168466",
        direction_id: 0,
        shape_id: "1246-45451-9463903a",
        trip_headsign: "Conifer Grove to Rosehill Schools ",
      },
      { trip_id: "" },
    ]);
    const { trips, failed } = await fetchRouteTrips(["S454-203"]);
    expect(mockFetchAll).toHaveBeenCalledWith("/routes/S454-203/trips");
    expect(failed).toBe(0);
    expect(trips).toEqual([
      {
        id: "1246-45451-28200-2-98168466",
        routeId: "S454-203",
        headsign: "Conifer Grove to Rosehill Schools",
        directionId: 0,
        shapeId: "1246-45451-9463903a",
      },
    ]);
  });

  it("retries a failed route once, and skips and counts one that fails again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = new Map<string, number>();
    mockFetchAll.mockImplementation((path: string) => {
      const n = (calls.get(path) ?? 0) + 1;
      calls.set(path, n);
      // S001 always fails; S457 is rate-limited on the first pass only.
      if (path.includes("S001") || (path.includes("S457") && n === 1)) {
        return Promise.reject(new Error("AT v3 429"));
      }
      return Promise.resolve([
        { trip_id: `${path}-trip`, direction_id: null, shape_id: null, trip_headsign: null },
      ]);
    });
    const { trips, failed } = await fetchRouteTrips(["S454-203", "S001-203", "S457-203"], 0);
    expect(failed).toBe(1);
    expect(trips.map((t) => t.routeId).sort()).toEqual(["S454-203", "S457-203"]);
    expect(trips[0]!.directionId).toBeNull();
    expect(calls.get("/routes/S001-203/trips")).toBe(2);
    expect(calls.get("/routes/S454-203/trips")).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("makes no call for an empty list", async () => {
    expect(await fetchRouteTrips([])).toEqual({ trips: [], failed: 0 });
    expect(mockFetchAll).not.toHaveBeenCalled();
  });
});
