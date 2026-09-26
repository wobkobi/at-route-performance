// tests/lib/route-geo.test.ts
// Unit tests for the road-line geometry helpers in route-geo.ts: the sideways
// offset and the simplification the network overlay thins a stored shape with.
import { offsetPath, simplifyPath } from "@/lib/route-geo";
import { describe, expect, it } from "vitest";

/**
 * Read a point from a path, failing loudly when the index is out of range.
 * @param path - The `[lat, lon]` path.
 * @param i - Index to read.
 * @returns The point at `i`.
 */
function at(path: [number, number][], i: number): [number, number] {
  const p = path[i];
  if (!p) throw new Error(`expected a point at index ${i}`);
  return p;
}

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
    expect(at(right, 0)[0]).toBeCloseTo(-36.85 - expectedDeg, 5);
    expect(at(left, 0)[0]).toBeCloseTo(-36.85 + expectedDeg, 5);
    // Longitude barely changes along an east-west heading.
    expect(at(right, 0)[1]).toBeCloseTo(174.7, 4);
  });

  it("offsets the two sides in opposite directions", () => {
    const line: [number, number][] = [
      [-36.0, 174.0],
      [-36.1, 174.1],
      [-36.2, 174.2],
    ];
    const a = offsetPath(line, 20, 1);
    const b = offsetPath(line, 20, -1);
    for (const [i, orig] of line.entries()) {
      const pa = at(a, i);
      const pb = at(b, i);
      expect(pa[0] - orig[0]).toBeCloseTo(-(pb[0] - orig[0]), 9);
      expect(pa[1] - orig[1]).toBeCloseTo(-(pb[1] - orig[1]), 9);
    }
  });
});

describe("simplifyPath", () => {
  it("returns a path of fewer than three points unchanged", () => {
    const two: [number, number][] = [
      [-36.85, 174.7],
      [-36.85, 174.8],
    ];
    expect(simplifyPath(two, 30)).toEqual(two);
    expect(simplifyPath([], 30)).toEqual([]);
  });

  it("drops the interior of a straight run and keeps both ends", () => {
    // Five points on one line of longitude, about 110m apart.
    const straight: [number, number][] = [
      [-36.85, 174.7],
      [-36.849, 174.7],
      [-36.848, 174.7],
      [-36.847, 174.7],
      [-36.846, 174.7],
    ];
    expect(simplifyPath(straight, 30)).toEqual([
      [-36.85, 174.7],
      [-36.846, 174.7],
    ]);
  });

  it("keeps a corner the tolerance cannot swallow", () => {
    // A right-angle turn: the corner sits about 1.1km off the line joining the
    // ends, so no sane tolerance may drop it.
    const corner: [number, number][] = [
      [-36.85, 174.7],
      [-36.85, 174.72],
      [-36.83, 174.72],
    ];
    expect(simplifyPath(corner, 30)).toEqual(corner);
  });

  it("thins in proportion to the tolerance, endpoints intact", () => {
    // A gentle zigzag: each step wanders about 11m off the straight line.
    const zigzag: [number, number][] = Array.from({ length: 21 }, (_, i): [number, number] => [
      -36.85 + i * 0.001,
      174.7 + (i % 2 === 0 ? 0 : 0.000125),
    ]);
    const fine = simplifyPath(zigzag, 5);
    const coarse = simplifyPath(zigzag, 30);
    expect(fine.length).toBeGreaterThan(coarse.length);
    expect(coarse).toEqual([zigzag[0], zigzag[20]]);
    expect(at(fine, 0)).toEqual(zigzag[0]);
    expect(at(fine, fine.length - 1)).toEqual(zigzag[20]);
  });
});
