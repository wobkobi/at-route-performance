// tests/lib/map/line-arrows.test.ts
// Direction arrows along a route line, spaced in screen pixels.
import { arrowPlacements, dropRepeatArrows } from "@/lib/map/line-arrows";
import { describe, expect, it } from "vitest";

const straightRight = [
  { x: 0, y: 0 },
  { x: 500, y: 0 },
];

describe("arrowPlacements", () => {
  it("spaces arrows evenly from the offset, pointing along the line", () => {
    const arrows = arrowPlacements(straightRight, 100, 50);
    expect(arrows.map((a) => a.x)).toEqual([50, 150, 250, 350, 450]);
    for (const a of arrows) expect(a.angle).toBeCloseTo(90);
  });

  it("keeps the spacing across vertices, whatever the point count", () => {
    const detailed = Array.from({ length: 51 }, (_, i) => ({ x: i * 10, y: 0 }));
    expect(arrowPlacements(detailed, 100, 50).map((a) => a.x)).toEqual([50, 150, 250, 350, 450]);
  });

  it("points up the screen for a line heading north", () => {
    const [a] = arrowPlacements(
      [
        { x: 0, y: 200 },
        { x: 0, y: 0 },
      ],
      100,
      50,
    );
    expect(a!.angle).toBeCloseTo(0);
    expect(a!.y).toBe(150);
  });

  it("slides an arrow off a stop, and drops it when no clear spot is left before the next", () => {
    const slid = arrowPlacements(straightRight, 100, 50, [{ x: 150, y: 0 }], 12);
    expect(slid[1]!.x).toBeGreaterThanOrEqual(162);
    expect(slid[1]!.x).toBeLessThan(250);
    expect(slid[2]!.x).toBe(250);

    // Stops every 10px from 105 to 245 leave nothing clear before 257, past the
    // next arrow's spot at 250, so the second arrow goes and the third slides.
    const crowded = Array.from({ length: 15 }, (_, i) => ({ x: 105 + i * 10, y: 0 }));
    const dropped = arrowPlacements(straightRight, 100, 50, crowded, 12);
    expect(dropped).toHaveLength(4);
    expect(dropped[1]!.x).toBeGreaterThanOrEqual(257);
    expect(dropped[2]!.x).toBe(350);
  });

  it("gives nothing for a line too short to draw", () => {
    expect(arrowPlacements([{ x: 0, y: 0 }], 100, 50)).toEqual([]);
  });
});

describe("dropRepeatArrows", () => {
  it("drops a nearby arrow pointing the same way, keeping the first", () => {
    const kept = dropRepeatArrows(
      [
        { x: 0, y: 0, angle: 90 },
        { x: 30, y: 5, angle: 100 },
        { x: 200, y: 0, angle: 90 },
      ],
      80,
    );
    expect(kept.map((a) => a.x)).toEqual([0, 200]);
  });

  it("keeps an arrow pointing the other way down the same road", () => {
    const kept = dropRepeatArrows(
      [
        { x: 0, y: 0, angle: 90 },
        { x: 10, y: 0, angle: 270 },
      ],
      80,
    );
    expect(kept).toHaveLength(2);
  });

  it("treats headings either side of north as the same way", () => {
    expect(
      dropRepeatArrows(
        [
          { x: 0, y: 0, angle: 355 },
          { x: 10, y: 0, angle: 5 },
        ],
        80,
      ),
    ).toHaveLength(1);
  });
});
