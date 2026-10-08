import { laneRuns, shiftPixels } from "@/lib/map/shared-roads";
import { describe, expect, it } from "vitest";

const LAT = -36.85;
const LON = 174.76;
/** Degrees of longitude in a metre, at the test latitude. */
const LON_PER_M = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));
/** Degrees of latitude in a metre. */
const LAT_PER_M = 1 / 111_320;

/**
 * A straight east-west path along the test latitude.
 * @param fromM - Start, metres east of the origin.
 * @param toM - End, metres east of the origin (smaller than `fromM` to run west).
 * @param northM - Metres north of the test latitude.
 * @returns The path as `[lat, lon]` pairs, a point every 50 m.
 */
function eastWest(fromM: number, toM: number, northM = 0): [number, number][] {
  const n = Math.round(Math.abs(toM - fromM) / 50);
  return Array.from({ length: n + 1 }, (_, i): [number, number] => [
    LAT + northM * LAT_PER_M,
    LON + (fromM + ((toM - fromM) * i) / n) * LON_PER_M,
  ]);
}

describe("laneRuns", () => {
  it("sets two colours on one road side by side", () => {
    const [a, b] = laneRuns(
      [
        { colour: "#aaaaaa", points: eastWest(0, 1000) },
        { colour: "#bbbbbb", points: eastWest(0, 1000) },
      ],
      30,
    );
    expect(a?.map((r) => r.slot)).toEqual([-0.5]);
    expect(b?.map((r) => r.slot)).toEqual([0.5]);
  });

  it("keeps each lane on its side when the routes travel the road in opposite directions", () => {
    // Both come back -0.5: to the left of each one's own travel, which is
    // opposite sides of the road for opposite directions, so they stay apart.
    const [a, b] = laneRuns(
      [
        { colour: "#aaaaaa", points: eastWest(0, 1000) },
        { colour: "#bbbbbb", points: eastWest(1000, 0) },
      ],
      30,
    );
    expect(a?.map((r) => r.slot)).toEqual([-0.5]);
    expect(b?.map((r) => r.slot)).toEqual([-0.5]);
  });

  it("lets routes of one colour share a lane", () => {
    const runs = laneRuns(
      [
        { colour: "#aaaaaa", points: eastWest(0, 1000) },
        { colour: "#aaaaaa", points: eastWest(0, 1000, 4) },
      ],
      30,
    );
    expect(runs.map((r) => r.map((run) => run.slot))).toEqual([[0], [0]]);
  });

  it("moves aside only along the stretch another colour shares, and the stretches meet", () => {
    const [a] = laneRuns(
      [
        { colour: "#aaaaaa", points: eastWest(0, 1500) },
        { colour: "#bbbbbb", points: eastWest(500, 1000) },
      ],
      30,
    );
    expect(a?.map((r) => r.slot)).toEqual([0, -0.5, 0]);
    for (let i = 0; i + 1 < (a?.length ?? 0); i++) {
      expect(a?.[i]?.points.at(-1)).toEqual(a?.[i + 1]?.points[0]);
    }
  });

  it("does not jog aside where a cross street meets the road", () => {
    const crossing: [number, number][] = [
      [LAT - 500 * LAT_PER_M, LON + 500 * LON_PER_M],
      [LAT + 500 * LAT_PER_M, LON + 500 * LON_PER_M],
    ];
    const [a] = laneRuns(
      [
        { colour: "#aaaaaa", points: eastWest(0, 1000) },
        { colour: "#bbbbbb", points: crossing },
      ],
      30,
    );
    expect(a?.map((r) => r.slot)).toEqual([0]);
  });

  it("thins each stretch to the tolerance", () => {
    const [a] = laneRuns([{ colour: "#aaaaaa", points: eastWest(0, 1000) }], 30);
    expect(a?.[0]?.points).toHaveLength(2);
  });

  it("gives a path under two points no runs", () => {
    expect(laneRuns([{ colour: "#aaaaaa", points: [[LAT, LON]] }], 30)).toEqual([[]]);
  });
});

describe("laneRuns on a divided road", () => {
  /**
   * How far north of the test latitude a run's first point sits.
   * @param run - The run.
   * @returns Metres north.
   */
  const northOf = (run: { points: [number, number][] } | undefined): number =>
    Math.round(((run?.points[0]?.[0] ?? 0) - LAT) / LAT_PER_M);

  it("pulls the other direction onto the first carriageway, and lanes the pair as one road", () => {
    // The Harbour Bridge: one carriageway each way, 45 m apart.
    const [a, b] = laneRuns(
      [
        { colour: "#aaaaaa", mode: "BUS", points: eastWest(0, 1000) },
        { colour: "#bbbbbb", mode: "BUS", points: eastWest(1000, 0, 45) },
      ],
      30,
    );
    expect(b?.map(northOf)).toEqual([0]);
    expect(a?.map((r) => r.slot)).toEqual([-0.5]);
    expect(b?.map((r) => r.slot)).toEqual([-0.5]);
  });

  it("leaves a parallel road running the same way where it is", () => {
    const [, b] = laneRuns(
      [
        { colour: "#aaaaaa", mode: "BUS", points: eastWest(0, 1000) },
        { colour: "#bbbbbb", mode: "BUS", points: eastWest(0, 1000, 45) },
      ],
      30,
    );
    expect(b?.map(northOf)).toEqual([45]);
  });

  it("leaves an opposite road beyond reach, or of another mode, where it is", () => {
    const [, far] = laneRuns(
      [
        { colour: "#aaaaaa", mode: "BUS", points: eastWest(0, 1000) },
        { colour: "#bbbbbb", mode: "BUS", points: eastWest(1000, 0, 80) },
      ],
      30,
    );
    expect(far?.map(northOf)).toEqual([80]);
    const [, rail] = laneRuns(
      [
        { colour: "#aaaaaa", mode: "TRAIN", points: eastWest(0, 1000) },
        { colour: "#bbbbbb", mode: "BUS", points: eastWest(1000, 0, 30) },
      ],
      30,
    );
    expect(rail?.map(northOf)).toEqual([30]);
  });

  it("pulls a path running the same way a few metres off onto the earlier one", () => {
    // Two routes' shapes for one road, traced 9 m apart.
    const [, b] = laneRuns(
      [
        { colour: "#aaaaaa", mode: "BUS", points: eastWest(0, 1000) },
        { colour: "#aaaaaa", mode: "BUS", points: eastWest(0, 1000, 9) },
      ],
      30,
    );
    expect(b?.map(northOf)).toEqual([0]);
  });

  it("gives routes of one colour one lane where their shapes sit apart", () => {
    // Only the route traced 9 m north is within the grid's reach of the red one
    // 21 m north, unless the two blue paths are first made one road.
    const runs = laneRuns(
      [
        { colour: "#0000ff", mode: "BUS", points: eastWest(0, 1000) },
        { colour: "#0000ff", mode: "BUS", points: eastWest(0, 1000, 9) },
        { colour: "#ff0000", mode: "BUS", points: eastWest(0, 1000, 21) },
      ],
      30,
    );
    expect(runs[1]?.map((r) => r.slot)).toEqual(runs[0]?.map((r) => r.slot));
  });

  it("does not move a road aside for a line of another mode beside it", () => {
    const [bus, rail] = laneRuns(
      [
        { colour: "#aaaaaa", mode: "BUS", points: eastWest(0, 1000) },
        { colour: "#bbbbbb", mode: "TRAIN", points: eastWest(0, 1000, 6) },
      ],
      30,
    );
    expect(bus?.map((r) => r.slot)).toEqual([0]);
    expect(rail?.map((r) => r.slot)).toEqual([0]);
  });

  it("does not pull a short opposite stretch across", () => {
    // 60 m beside the other road, under the 90 m a pull must last.
    const [, b] = laneRuns(
      [
        { colour: "#aaaaaa", mode: "BUS", points: eastWest(0, 1000) },
        { colour: "#bbbbbb", mode: "BUS", points: eastWest(1030, 970, 40) },
      ],
      30,
    );
    expect(b?.map(northOf)).toEqual([40]);
  });
});

describe("shiftPixels", () => {
  it("shifts to the left of travel, which is up the screen for a line running right", () => {
    expect(
      shiftPixels(
        [
          [0, 0],
          [10, 0],
        ],
        2,
      ),
    ).toEqual([
      [0, -2],
      [10, -2],
    ]);
  });

  it("keeps a bend's corner on the averaged normal", () => {
    const [, corner] = shiftPixels(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      1,
    );
    expect(corner?.[0]).toBeCloseTo(10 + Math.SQRT1_2);
    expect(corner?.[1]).toBeCloseTo(-Math.SQRT1_2);
  });

  it("leaves a line with no shift untouched", () => {
    const line: [number, number][] = [
      [0, 0],
      [5, 5],
    ];
    expect(shiftPixels(line, 0)).toBe(line);
  });
});
