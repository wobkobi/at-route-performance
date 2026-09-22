// tests/lib/train-consist.test.ts
// Unit tests for trainCars, using unit readings taken from AT's feed on 22 Sep 2026.
import { type TrainUnit, trainCars } from "@/lib/train-consist";
import { describe, expect, it } from "vitest";

/**
 * A unit reading with defaults for the fields a test does not care about.
 * @param id - Vehicle id.
 * @param lat - Latitude.
 * @param lon - Longitude.
 * @param rest - Speed, bearing and timestamp overrides.
 * @returns The reading.
 */
function unit(id: string, lat: number, lon: number, rest: Partial<TrainUnit> = {}): TrainUnit {
  return { id, lat, lon, speed: 0, bearing: null, timestamp: 1_790_036_900, ...rest };
}

/** Metres to degrees of latitude, for building a train along a north-south line. */
const M = 1 / 111_195;

describe("trainCars", () => {
  it("counts a lone unit as 3 cars", () => {
    const lead = unit("1033", -36.9, 174.8);
    expect(trainCars([lead], []).get("1033")).toBe(3);
  });

  it("pairs a unit moving with the lead into a 6-car (AMP 1020 + AMP 129)", () => {
    const lead = unit("1020", -36.8939, 174.8045, { speed: 18.9, bearing: 130.9 });
    const coupled = unit("129", -36.8946, 174.8054, { speed: 18.6, bearing: 134.5 });
    expect(trainCars([lead], [coupled]).get("1020")).toBe(6);
  });

  it("chains a third unit through the middle one into a 9-car", () => {
    const lead = unit("a", -36.9, 174.8, { speed: 15, bearing: 0 });
    const mid = unit("b", -36.9 - 75 * M, 174.8, { speed: 15, bearing: 0 });
    const far = unit("c", -36.9 - 150 * M, 174.8, { speed: 15, bearing: 2 });
    expect(trainCars([lead], [mid, far]).get("a")).toBe(9);
  });

  it("never goes past 9 cars", () => {
    const lead = unit("a", -36.9, 174.8);
    const free = [1, 2, 3].map((i) => unit(`f${i}`, -36.9 - i * 50 * M, 174.8));
    expect(trainCars([lead], free).get("a")).toBe(9);
  });

  it("ignores a train passing the other way (AMP 1018 and AMP 620)", () => {
    const lead = unit("1018", -36.8627, 174.7818, { speed: 10.5, bearing: 344.9 });
    const passing = unit("620", -36.8645, 174.7812, { speed: 9.5, bearing: 221.4 });
    expect(trainCars([lead], [passing]).get("1018")).toBe(3);
  });

  it("ignores a parked unit beside a moving train", () => {
    const lead = unit("a", -36.9, 174.8, { speed: 12, bearing: 90 });
    const parked = unit("p", -36.9 - 60 * M, 174.8, { speed: 0 });
    expect(trainCars([lead], [parked]).get("a")).toBe(3);
  });

  it("ignores a parked unit too far from a stopped train", () => {
    const lead = unit("a", -36.9, 174.8);
    const parked = unit("p", -36.9 - 140 * M, 174.8);
    expect(trainCars([lead], [parked]).get("a")).toBe(3);
  });

  it("gives a shared unit to the nearer of two trains", () => {
    const near = unit("n", -36.9, 174.8, { speed: 10, bearing: 0 });
    const far = unit("f", -36.9 - 200 * M, 174.8, { speed: 10, bearing: 0 });
    const between = unit("x", -36.9 - 60 * M, 174.8, { speed: 10, bearing: 0 });
    const cars = trainCars([near, far], [between]);
    expect(cars.get("n")).toBe(6);
    expect(cars.get("f")).toBe(3);
  });

  it("skips readings a minute or more apart", () => {
    const lead = unit("a", -36.9, 174.8, { timestamp: 1000 });
    const stale = unit("s", -36.9 - 60 * M, 174.8, { timestamp: 1100 });
    expect(trainCars([lead], [stale]).get("a")).toBe(3);
  });
});
