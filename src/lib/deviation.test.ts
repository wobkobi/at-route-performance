// src/lib/deviation.test.ts
// Unit tests for ghost classification and the real-reading filters in deviation.ts.
import {
  GHOST_GAP_SEC,
  isGhostDeviation,
  NO_DELAY_SOURCE,
  realDeviationExprFor,
  realDeviationMatchFor,
  runDeviationLevel,
  type TripObservation,
  UNCLASSIFIED_LIMIT_SEC,
} from "@/lib/deviation";
import { describe, expect, it } from "vitest";

/**
 * Build observations, one per place.
 * @param devs - Signed deviations, one per distinct place.
 * @returns Observations with generated place ids.
 */
function run(...devs: number[]): TripObservation[] {
  return devs.map((deviationSec, i) => ({ stationId: `s${i}`, deviationSec }));
}

describe("runDeviationLevel", () => {
  it("takes the median deviation across the run's places", () => {
    expect(runDeviationLevel(run(60, 120, 180))).toBe(120);
  });

  it("keeps each place's reading nearest its own schedule", () => {
    // A stop carrying both the real arrival and a ghost re-report contributes
    // only the real one, so the ghost cannot drag the level.
    const observations: TripObservation[] = [
      { stationId: "a", deviationSec: 120 },
      { stationId: "a", deviationSec: 3900 },
      { stationId: "b", deviationSec: 180 },
      { stationId: "c", deviationSec: 150 },
    ];
    expect(runDeviationLevel(observations)).toBe(150);
  });

  it("resists ghosts outnumbering real readings at a place", () => {
    const observations: TripObservation[] = [
      { stationId: "a", deviationSec: 3600 },
      { stationId: "a", deviationSec: 3700 },
      { stationId: "a", deviationSec: 60 },
      { stationId: "b", deviationSec: 90 },
      { stationId: "c", deviationSec: 120 },
    ];
    expect(runDeviationLevel(observations)).toBe(90);
  });

  it("returns null with nothing to go on", () => {
    expect(runDeviationLevel([])).toBeNull();
  });
});

describe("isGhostDeviation", () => {
  it("keeps a genuinely catastrophic delay - the run is late throughout", () => {
    // 70 minutes late at every stop: a magnitude cap would have deleted this,
    // which is exactly the evidence the site exists to show.
    const level = runDeviationLevel(run(4100, 4200, 4260, 4320)) as number;
    expect(level).not.toBeNull();
    for (const d of [4100, 4200, 4260, 4320]) {
      expect(isGhostDeviation(d, level)).toBe(false);
    }
  });

  it("flags a re-report sitting a vehicle cycle off the run", () => {
    const level = runDeviationLevel(run(60, 120, 180, 3900)) as number;
    expect(isGhostDeviation(3900, level)).toBe(true);
    expect(isGhostDeviation(120, level)).toBe(false);
  });

  it("treats an accumulating delay as real, not ghostly", () => {
    const devs = [0, 300, 600, 900, 1200, 1500];
    const level = runDeviationLevel(run(...devs)) as number;
    for (const d of devs) expect(isGhostDeviation(d, level)).toBe(false);
  });

  it("is exclusive at the gap boundary", () => {
    expect(isGhostDeviation(GHOST_GAP_SEC, 0)).toBe(false);
    expect(isGhostDeviation(GHOST_GAP_SEC + 1, 0)).toBe(true);
    expect(isGhostDeviation(-GHOST_GAP_SEC - 1, 0)).toBe(true);
  });
});

describe("real-reading filters", () => {
  it("keeps the magnitude guard on an unclassified window", () => {
    expect(realDeviationMatchFor(false)).toEqual({
      ghost: { $ne: true },
      source: { $ne: NO_DELAY_SOURCE },
      deviationSec: { $gte: -UNCLASSIFIED_LIMIT_SEC, $lte: UNCLASSIFIED_LIMIT_SEC },
    });
    expect(realDeviationExprFor(false)).toEqual({
      $and: [
        { $ne: ["$ghost", true] },
        { $ne: ["$source", NO_DELAY_SOURCE] },
        { $gte: ["$deviationSec", -UNCLASSIFIED_LIMIT_SEC] },
        { $lte: ["$deviationSec", UNCLASSIFIED_LIMIT_SEC] },
      ],
    });
  });

  it("drops the guard once the ghost pass has classified the window", () => {
    expect(realDeviationMatchFor(true)).toEqual({
      ghost: { $ne: true },
      source: { $ne: NO_DELAY_SOURCE },
    });
    expect(realDeviationExprFor(true)).toEqual({
      $and: [{ $ne: ["$ghost", true] }, { $ne: ["$source", NO_DELAY_SOURCE] }],
    });
  });
});
