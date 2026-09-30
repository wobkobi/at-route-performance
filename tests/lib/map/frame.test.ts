// tests/lib/map/frame.test.ts
// The live map's opening frame: the city core, not every outlying vehicle.
import { coreBounds } from "@/lib/map/frame";
import { describe, expect, it } from "vitest";

describe("coreBounds", () => {
  it("drops a far-flung point once there are enough to call it an outlier", () => {
    const city = Array.from(
      { length: 99 },
      (_, i) => [-36.85 - i * 0.001, 174.76 + i * 0.001] as const,
    );
    const wellsford = [-36.29, 174.52] as const;
    const box = coreBounds([...city, wellsford])!;
    expect(box[1][0]).toBeLessThan(-36.8);
    expect(box[0][1]).toBeGreaterThan(174.7);
  });

  it("keeps every point when there are only a few", () => {
    expect(
      coreBounds([
        [-36.85, 174.76],
        [-36.29, 174.52],
      ]),
    ).toEqual([
      [-36.85, 174.52],
      [-36.29, 174.76],
    ]);
  });

  it("returns null with nothing to frame", () => {
    expect(coreBounds([])).toBeNull();
  });
});
