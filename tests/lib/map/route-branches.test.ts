import { pathLength, routePaths } from "@/lib/map/route-branches";
import { describe, expect, it } from "vitest";

const LAT = -36.85;
const LON = 174.76;
/** Degrees of longitude in a metre, at the test latitude. */
const LON_PER_M = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));
/** Degrees of latitude in a metre. */
const LAT_PER_M = 1 / 111_320;

/**
 * A straight path between two points given in metres from the origin.
 * @param from - Start, `[east, north]` metres.
 * @param to - End, `[east, north]` metres.
 * @returns The path as `[lat, lon]` pairs, a point every 100 m.
 */
function line(from: [number, number], to: [number, number]): [number, number][] {
  const n = Math.max(1, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / 100));
  return Array.from({ length: n + 1 }, (_, i): [number, number] => [
    LAT + (from[1] + ((to[1] - from[1]) * i) / n) * LAT_PER_M,
    LON + (from[0] + ((to[0] - from[0]) * i) / n) * LON_PER_M,
  ]);
}

describe("routePaths", () => {
  it("draws the longest regular shape, not the busiest short-working", () => {
    const short = { points: line([0, 0], [2000, 0]), trips: 190 };
    const full = { points: line([0, 0], [5000, 0]), trips: 103 };
    const paths = routePaths([short, full]);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toBe(full.points);
  });

  it("keeps a one-trip oddity from becoming the main shape", () => {
    const main = { points: line([0, 0], [2000, 0]), trips: 190 };
    const odd = { points: line([0, 0], [9000, 0]), trips: 1 };
    expect(routePaths([main, odd])).toEqual([main.points]);
  });

  it("adds a branch where another regular pattern leaves the main road, once for both directions", () => {
    // A trunk east, then a second pattern turning north at 1 km.
    const trunk = { points: line([0, 0], [2000, 0]), trips: 116 };
    const out = {
      points: [...line([0, 0], [1000, 0]), ...line([1000, 0], [1000, 800]).slice(1)],
      trips: 48,
    };
    const back = { points: [...out.points].reverse(), trips: 38 };
    const paths = routePaths([trunk, out, back]);
    expect(paths).toHaveLength(2);
    const branch = paths[1] ?? [];
    // Runs from the trunk up to the branch's end.
    expect(pathLength(branch)).toBeGreaterThan(700);
    expect(pathLength(branch)).toBeLessThan(900);
  });

  it("runs a branch that leaves at an angle all the way onto the road it leaves and rejoins", () => {
    // A 3 km trunk east, and a shorter pattern that bows north off it at 30
    // degrees between 500 m and 1.5 km. Ending where the bow first comes within
    // the covering distance would leave both ends floating short of the trunk.
    const trunk = { points: line([0, 0], [3000, 0]), trips: 116 };
    const bow = {
      points: [
        ...line([0, 0], [500, 0]),
        ...line([500, 0], [1000, 289]).slice(1),
        ...line([1000, 289], [1500, 0]).slice(1),
        ...line([1500, 0], [2000, 0]).slice(1),
      ],
      trips: 88,
    };
    const paths = routePaths([trunk, bow]);
    expect(paths).toHaveLength(2);
    const branch = paths[1] ?? [];
    /**
     * How far north of the trunk a point sits.
     * @param p - `[lat, lon]`.
     * @returns Metres.
     */
    const north = (p: [number, number] | undefined): number => ((p?.[0] ?? NaN) - LAT) / LAT_PER_M;
    expect(Math.abs(north(branch[0]))).toBeLessThan(1);
    expect(Math.abs(north(branch.at(-1)))).toBeLessThan(1);
  });

  it("leaves out a stretch shorter than the branch minimum, or of a rare pattern", () => {
    const trunk = { points: line([0, 0], [2000, 0]), trips: 100 };
    const jog = {
      points: [...line([0, 0], [1000, 0]), ...line([1000, 0], [1000, 100]).slice(1)],
      trips: 50,
    };
    const rare = {
      points: [...line([0, 0], [1000, 0]), ...line([1000, 0], [1000, 900]).slice(1)],
      trips: 5,
    };
    expect(routePaths([trunk, jog, rare])).toEqual([trunk.points]);
  });

  it("counts the other direction on a road as covered", () => {
    const up = { points: line([0, 0], [2000, 0]), trips: 100 };
    const down = { points: line([2000, 25], [0, 25]), trips: 100 };
    expect(routePaths([up, down])).toHaveLength(1);
  });

  it("gives a route with no usable shape no paths", () => {
    expect(routePaths([{ points: [], trips: 10 }])).toEqual([]);
  });
});
