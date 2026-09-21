// tests/lib/vehicle-status.test.ts
// Unit tests for the live vehicle delay verdict.
import { parseBearing, vehicleStatus, vehiclesOnMap } from "@/lib/vehicle-status";
import type { LiveVehicle } from "@/lib/vehicles";
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

describe("parseBearing", () => {
  it("reads 0 and a missing heading as unknown", () => {
    expect(parseBearing(0)).toBeNull();
    expect(parseBearing("0")).toBeNull();
    expect(parseBearing(undefined)).toBeNull();
    expect(parseBearing("")).toBeNull();
    expect(parseBearing("north")).toBeNull();
  });

  it("keeps a real heading, as a number, inside one turn", () => {
    expect(parseBearing("87.5")).toBe(87.5);
    expect(parseBearing(-90)).toBe(270);
    expect(parseBearing(450)).toBe(90);
  });
});

describe("vehiclesOnMap", () => {
  /**
   * A vehicle at a point, on direction 0 unless told otherwise.
   * @param id - The vehicle id.
   * @param lat - Latitude.
   * @param lon - Longitude.
   * @param extra - Fields to override.
   * @returns The vehicle.
   */
  const veh = (
    id: string,
    lat: number,
    lon: number,
    extra: Partial<LiveVehicle> = {},
  ): LiveVehicle => ({
    vehicleId: id,
    label: null,
    routeId: "STH",
    tripId: `trip-${id}`,
    lat,
    lon,
    delaySec: 0,
    bearing: null,
    directionId: 0,
    ...extra,
  });
  // Papakura to Pukekohe, roughly: two stations about 18km apart.
  const papakura = { lat: -37.0645, lon: 174.9446 };
  const pukekohe = { lat: -37.2031, lon: 174.9095 };
  const line: Array<[number, number]> = [
    [papakura.lat, papakura.lon],
    [pukekohe.lat, pukekohe.lon],
  ];
  const midway = veh("mid", -37.1338, 174.9271);

  it("keeps a train between two far-apart stations", () => {
    expect(vehiclesOnMap([midway], { lines: [line], stops: [papakura, pukekohe] })).toHaveLength(1);
  });

  it("leaves out a vehicle well away from the line", () => {
    const depot = veh("depot", -37.1338, 175.0); // about 6km east
    expect(vehiclesOnMap([depot], { lines: [line], stops: [] })).toHaveLength(0);
  });

  it("measures to the stops when there are no lines", () => {
    expect(vehiclesOnMap([midway], { lines: [], stops: [papakura, pukekohe] })).toHaveLength(0);
    const nearStop = veh("near", papakura.lat + 0.005, papakura.lon);
    expect(vehiclesOnMap([nearStop], { lines: [], stops: [papakura] })).toHaveLength(1);
  });

  it("drops a vehicle with no direction from a direction-filtered map", () => {
    const unknown = veh("unknown", midway.lat, midway.lon, { directionId: null });
    const other = veh("other", midway.lat, midway.lon, { directionId: 1 });
    const scope = { directionIds: [0], lines: [line], stops: [] };
    expect(vehiclesOnMap([midway, unknown, other], scope).map((v) => v.vehicleId)).toEqual(["mid"]);
    expect(vehiclesOnMap([unknown], { lines: [line], stops: [] })).toHaveLength(1);
  });

  it("shows only the trip's own vehicle on a trip map, wherever it is", () => {
    const far = veh("far", -36.8, 174.7);
    expect(
      vehiclesOnMap([midway, far], { tripId: "trip-far", lines: [line], stops: [] }).map(
        (v) => v.vehicleId,
      ),
    ).toEqual(["far"]);
  });
});
