// tests/lib/ghost-pass.test.ts
// Unit tests for the pure parts of the nightly ghost pass: the level pipeline's
// shape and the per-trip update batches. ghost-pass.int.test.ts runs the same
// stages and updates against MongoDB.
import { cancellationStage } from "@/lib/cancellation";
import { GHOST_GAP_SEC } from "@/lib/deviation";
import {
  anchorGapSec,
  bsonWindow,
  findSilentSibling,
  ghostLevelStages,
  ghostPassPipeline,
  ghostUpdateBatches,
  isWholeGhostRun,
  MIN_GHOST_RUN_STOPS,
  SIBLING_GAP_SEC,
  UPDATE_BATCH,
  wholeGhostShape,
  type GhostRunCandidate,
  type TripLevel,
} from "@/lib/ghost-pass";
import { nzServiceDayRange, serviceDayClockInstant, serviceDayClockSeconds } from "@/lib/time";
import { describe, expect, it, vi } from "vitest";

// The module under test imports the Prisma client; the pure parts never touch it.
vi.mock("@/lib/db", () => ({ prisma: {} }));

const window = bsonWindow(nzServiceDayRange("2026-09-11"));

describe("ghostPassPipeline", () => {
  it("matches the day on scheduledAt and then reduces to one level per trip", () => {
    const pipeline = ghostPassPipeline(window);
    expect(pipeline[0]).toEqual({
      $match: {
        scheduledAt: {
          $gte: { $date: "2026-09-10T16:00:00.000Z" },
          $lt: { $date: "2026-09-11T16:00:00.000Z" },
        },
      },
    });
    expect(pipeline.slice(1)).toEqual(ghostLevelStages());
  });

  it("keeps the signed best reading per stop and carries the whole-run rule's inputs", () => {
    const [abs, perStop, perTrip, project] = ghostLevelStages();
    expect(abs).toEqual({ $addFields: { absDev: { $abs: "$deviationSec" } } });
    expect(perStop).toEqual({
      $group: {
        _id: { tripId: "$tripId", stopId: "$stopId" },
        best: { $top: { sortBy: { absDev: 1 }, output: "$deviationSec" } },
        sched: { $min: "$scheduledAt" },
        route: { $min: "$routeId" },
        veh: { $min: "$vehicleId" },
      },
    });
    // stops counts distinct stops, not rows: the per-stop group already collapsed
    // a visit's re-reports into one best.
    expect(perTrip).toEqual({
      $group: {
        _id: "$_id.tripId",
        deviations: { $push: "$best" },
        firstScheduled: { $min: "$sched" },
        minAbs: { $min: { $abs: "$best" } },
        stops: { $sum: 1 },
        routeId: { $min: "$route" },
        vehicleId: { $min: "$veh" },
      },
    });
    // The element at floor(n / 2) of the sorted readings, as medianDeviation picks.
    expect(project).toEqual({
      $project: {
        _id: 1,
        firstScheduled: 1,
        minAbs: 1,
        stops: 1,
        routeId: 1,
        vehicleId: 1,
        level: {
          $arrayElemAt: [
            { $sortArray: { input: "$deviations", sortBy: 1 } },
            { $toInt: { $floor: { $divide: [{ $size: "$deviations" }, 2] } } },
          ],
        },
      },
    });
  });
});

describe("ghostUpdateBatches", () => {
  it("rewrites every row of a trip in one multi-update, flagging outside the gap and clearing inside", () => {
    const [batch] = ghostUpdateBatches([{ tripId: "T1", level: 120 }], window);
    expect(batch).toHaveLength(1);
    expect(batch?.[0]).toEqual({
      q: { tripId: "T1", scheduledAt: window },
      u: [
        {
          $set: {
            ghost: {
              $cond: [
                {
                  $or: [
                    { $gt: ["$deviationSec", 120 + GHOST_GAP_SEC] },
                    { $lt: ["$deviationSec", 120 - GHOST_GAP_SEC] },
                  ],
                },
                true,
                "$$REMOVE",
              ],
            },
          },
        },
      ],
      multi: true,
    });
  });

  it("splits the trips into batches of UPDATE_BATCH, in order", () => {
    const levels: TripLevel[] = Array.from({ length: UPDATE_BATCH * 2 + 3 }, (_, i) => ({
      tripId: `T${i}`,
      level: i,
    }));
    const batches = ghostUpdateBatches(levels, window);
    expect(batches.map((b) => b.length)).toEqual([UPDATE_BATCH, UPDATE_BATCH, 3]);
    expect(batches[2]?.[2]?.q.tripId).toBe(`T${UPDATE_BATCH * 2 + 2}`);
  });

  it("yields no batches for an empty day", () => {
    expect(ghostUpdateBatches([], window)).toEqual([]);
  });

  it("flags every row of a hidden run outright, whatever its level says", () => {
    const [batch] = ghostUpdateBatches(
      [
        { tripId: "T1", level: 120 },
        { tripId: "GHOST", level: -5792 },
      ],
      window,
      new Set(["GHOST"]),
    );
    // The hidden run's own readings agree with each other, so the level rule
    // would clear every one of them. The whole-run verdict overrides it.
    expect(batch?.[1]).toEqual({
      q: { tripId: "GHOST", scheduledAt: window },
      u: [{ $set: { ghost: true } }],
      multi: true,
    });
    expect(JSON.stringify(batch?.[0])).toContain("REMOVE");
  });
});

describe("anchorGapSec", () => {
  it("reads a run stored against its own schedule as zero", () => {
    expect(anchorGapSec(78_300, 78_300)).toBe(0);
  });

  it("reads a full vehicle cycle as an hour, not as nothing", () => {
    // 1155-71203-58560-2-528ac570 on 2026-09-14: start 16:16, earliest stored
    // schedule 17:16 Auckland.
    expect(anchorGapSec(58_560, 62_160)).toBe(3600);
  });

  it("wraps rather than reading a boundary run as a day off", () => {
    // Shape from 1117-01202-17520-2-0ddbe302: a run starting 04:52, whose
    // earliest in-window reading sits at 04:50. Measured plainly, a run whose
    // readings cross the boundary reads as ~86,000 s off its own start; wrapped,
    // it reads as the two minutes it really is.
    expect(anchorGapSec(17_520, 17_400)).toBe(120);
    expect(anchorGapSec(17_520, 17_400 + 86_400)).toBe(120);
    expect(anchorGapSec(120, 86_300)).toBe(220);
  });

  it("never exceeds half a day", () => {
    expect(anchorGapSec(0, 43_200)).toBe(43_200);
    expect(anchorGapSec(0, 43_201)).toBe(43_199);
  });
});

describe("serviceDayClockSeconds", () => {
  it("inverts serviceDayClockInstant, so a run reads back its own start", () => {
    const { start } = nzServiceDayRange("2026-09-14");
    expect(serviceDayClockSeconds(start, serviceDayClockInstant(start, 78_300))).toBe(78_300);
    // 17:16 Auckland on 14 September, the earliest stored schedule of the one
    // whole-ghost run in the data.
    expect(serviceDayClockSeconds(start, new Date("2026-09-14T05:16:00.000Z"))).toBe(62_160);
  });

  it("leaves a post-midnight reading unwrapped for the caller to wrap", () => {
    const { start } = nzServiceDayRange("2026-09-14");
    // 01:30 Auckland on 15 September is still the 14 September service day:
    // 25:30 on its GTFS clock.
    expect(serviceDayClockSeconds(start, new Date("2026-09-14T13:30:00.000Z"))).toBe(91_800);
  });
});

const DAY_START = nzServiceDayRange("2026-09-14").start;

/**
 * A run reduced to the whole-run rule's inputs, on 14 September 2026.
 * @param overrides - Fields the case changes.
 * @returns The candidate.
 */
function candidate(overrides: Partial<GhostRunCandidate> = {}): GhostRunCandidate {
  return {
    tripId: "1155-71203-58560-2-528ac570",
    routeId: "712-221",
    vehicleId: "26207",
    stops: 3,
    minAbsSec: 5742,
    levelSec: -5792,
    // 17:16 Auckland, a full cycle after the run's own 16:16 start.
    firstScheduled: new Date("2026-09-14T05:16:00.000Z"),
    dayStart: DAY_START,
    ...overrides,
  };
}

describe("isWholeGhostRun", () => {
  it("fires on the one real instance in the data", () => {
    // 1155-71203-58560-2-528ac570 on 2026-09-14: start 58560 (16:16), earliest
    // stored schedule 17:16, per-stop bests -5742, -5822, -5792. Both candidate
    // slots either side reported with other vehicles, so the sibling test names
    // nothing and belongsToTripId stays null.
    expect(isWholeGhostRun(candidate(), null)).toEqual({
      ghost: true,
      evidence: ["anchor"],
      belongsToTripId: null,
    });
  });

  it("names the run the readings belong to when the sibling test fires", () => {
    expect(isWholeGhostRun(candidate(), "1155-71203-62160-2-528ac570")).toEqual({
      ghost: true,
      evidence: ["anchor", "silent-sibling"],
      belongsToTripId: "1155-71203-62160-2-528ac570",
    });
  });

  it("does not fire for the 152 run in either shape", () => {
    // 1108-15203-78300-2-58ac9d51 on 2026-09-14 as stored (minAbs 129), and in
    // its post-Fix-1 shape (minAbs 60). Neither clears the gap, so the necessary
    // condition fails before any corroboration is looked at.
    const stored = candidate({
      tripId: "1108-15203-78300-2-58ac9d51",
      routeId: "152-203",
      stops: 8,
      minAbsSec: 129,
      levelSec: 3375,
      firstScheduled: new Date("2026-09-14T09:45:00.000Z"),
    });
    expect(isWholeGhostRun(stored, null).ghost).toBe(false);
    expect(
      isWholeGhostRun({ ...stored, stops: 16, minAbsSec: 60, levelSec: -128 }, null).ghost,
    ).toBe(false);
  });

  it("does not fire for a run that is genuinely an hour late at every stop", () => {
    // The guard that matters most: a real 21:45 run, 3600 s late everywhere, is
    // measured against its OWN schedule, so its anchor is zero however large the
    // delay. Showing this run is the point of the site.
    const late = candidate({
      tripId: "1108-15203-78300-2-58ac9d51",
      routeId: "152-203",
      stops: 12,
      minAbsSec: 3600,
      levelSec: 3600,
      // Its own 21:45, not a cycle away.
      firstScheduled: new Date("2026-09-14T09:45:00.000Z"),
    });
    expect(anchorGapSec(78_300, serviceDayClockSeconds(DAY_START, late.firstScheduled))).toBe(0);
    expect(isWholeGhostRun(late, null)).toEqual({
      ghost: false,
      evidence: [],
      belongsToTripId: null,
    });
  });

  it("never fires on a two-reading run", () => {
    expect(isWholeGhostRun(candidate({ stops: 2 }), "1155-71203-62160-2-528ac570").ghost).toBe(
      false,
    );
  });

  it("gives up on a trip id that encodes no start", () => {
    expect(isWholeGhostRun(candidate({ tripId: "no-start-here" }), null).ghost).toBe(false);
  });
});

describe("wholeGhostShape", () => {
  it("is necessary and never sufficient", () => {
    expect(wholeGhostShape(candidate())).toBe(true);
    expect(wholeGhostShape(candidate({ minAbsSec: GHOST_GAP_SEC }))).toBe(false);
    expect(wholeGhostShape(candidate({ minAbsSec: GHOST_GAP_SEC + 1 }))).toBe(true);
    expect(wholeGhostShape(candidate({ stops: MIN_GHOST_RUN_STOPS - 1 }))).toBe(false);
  });
});

describe("hiding a run that AT also cancelled", () => {
  it("leaves the cancellation reading as one that never ran", () => {
    // Flagging every reading of a run empties the arrival list cancellationStage
    // sees, so a hidden run AT also flagged reads as cancelled outright rather
    // than cut short. That is the intended reading, not a bug, but it is a real
    // side effect of the rule and is pinned here.
    expect(cancellationStage("2026-09-14T09:00:00.000Z", [])).toBe("before");
  });
});

describe("findSilentSibling", () => {
  // The candidate is stored against the 21:45 slot but its readings sit an hour
  // late, so the run they physically describe started at 22:45.
  const displaced = candidate({
    tripId: "1108-15203-78300-2-58ac9d51",
    routeId: "152-203",
    stops: 5,
    minAbsSec: 3237,
    levelSec: 3600,
    firstScheduled: new Date("2026-09-14T09:45:00.000Z"),
  });

  /** The 22:45 slot that reported nothing, and the 23:45 one that proves its pattern ran. */
  const slots = [
    { tripId: "1108-15203-78300-2-58ac9d51", startSec: 78_300, reported: true },
    { tripId: "1108-15203-81900-2-6dc59f13", startSec: 81_900, reported: false },
    { tripId: "1108-15203-81900-2-522a02b3", startSec: 81_900, reported: false },
    { tripId: "1108-15203-85500-2-6dc59f13", startSec: 85_500, reported: true },
  ];

  it("names the silent slot whose own pattern reported within the hour", () => {
    expect(findSilentSibling(displaced, slots)).toBe("1108-15203-81900-2-6dc59f13");
  });

  it("names nothing when the slot the readings describe did report", () => {
    const ran = slots.map((s) =>
      s.tripId === "1108-15203-81900-2-6dc59f13" ? { ...s, reported: true } : s,
    );
    expect(findSilentSibling(displaced, ran)).toBeNull();
  });

  it("will not name a slot on the strength of a start second alone", () => {
    // Drop the 23:45 mate and only decoys are left: four ids share start 81900
    // under this prefix and nothing then proves which pattern ran.
    expect(findSilentSibling(displaced, slots.slice(0, 3))).toBeNull();
  });

  it("names nothing when no silent slot sits near the readings' physical time", () => {
    const far = slots.map((s) => ({ ...s, startSec: s.startSec + 2 * SIBLING_GAP_SEC }));
    expect(findSilentSibling(displaced, far)).toBeNull();
  });

  it("names nothing with no siblings to look at", () => {
    expect(findSilentSibling(displaced, [])).toBeNull();
  });
});
