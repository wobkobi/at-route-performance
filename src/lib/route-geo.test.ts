// src/lib/route-geo.test.ts
/**
 * @description Unit tests for the road-line offset geometry helper in route-geo.ts.
 */
import { offsetPath } from "@/lib/route-geo";
import { describe, expect, it } from "vitest";

describe("offsetPath", () => {
  it("returns the path unchanged when it has fewer than 2 points", () => {
    expect(offsetPath([[-36.85, 174.76]], 10, 1)).toEqual([[-36.85, 174.76]]);
  });

  it("shifts an east-west line north or south by ~the offset distance", () => {
    // A horizontal line (constant lat, increasing lon) heads east; the right-hand
    // normal points south, so side=1 lowers latitude and side=-1 raises it.
    const line: [number, number][] = [
      [-36.85, 174.7],
      [-36.85, 174.8],
    ];
    const right = offsetPath(line, 100, 1);
    const left = offsetPath(line, 100, -1);
    const expectedDeg = 100 / 111_320;
    expect(right[0][0]).toBeCloseTo(-36.85 - expectedDeg, 5);
    expect(left[0][0]).toBeCloseTo(-36.85 + expectedDeg, 5);
    // Longitude barely changes along an east-west heading.
    expect(right[0][1]).toBeCloseTo(174.7, 4);
  });

  it("offsets the two sides in opposite directions", () => {
    const line: [number, number][] = [
      [-36.0, 174.0],
      [-36.1, 174.1],
      [-36.2, 174.2],
    ];
    const a = offsetPath(line, 20, 1);
    const b = offsetPath(line, 20, -1);
    for (let i = 0; i < line.length; i++) {
      expect(a[i][0] - line[i][0]).toBeCloseTo(-(b[i][0] - line[i][0]), 9);
      expect(a[i][1] - line[i][1]).toBeCloseTo(-(b[i][1] - line[i][1]), 9);
    }
  });
});
