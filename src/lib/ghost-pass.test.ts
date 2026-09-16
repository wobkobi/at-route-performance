// src/lib/ghost-pass.test.ts
// Unit tests for the pure parts of the nightly ghost pass: the level pipeline's
// shape and the per-trip update batches. ghost-pass.int.test.ts runs the same
// stages and updates against MongoDB.
import { GHOST_GAP_SEC } from "@/lib/deviation";
import {
  bsonWindow,
  ghostLevelStages,
  ghostPassPipeline,
  ghostUpdateBatches,
  UPDATE_BATCH,
  type TripLevel,
} from "@/lib/ghost-pass";
import { nzServiceDayRange } from "@/lib/time";
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

  it("keeps the signed best reading per stop and takes the exact median per trip", () => {
    const [abs, perStop, perTrip, level] = ghostLevelStages();
    expect(abs).toEqual({ $addFields: { absDev: { $abs: "$deviationSec" } } });
    expect(perStop).toEqual({
      $group: {
        _id: { tripId: "$tripId", stopId: "$stopId" },
        best: { $top: { sortBy: { absDev: 1 }, output: "$deviationSec" } },
      },
    });
    expect(perTrip).toEqual({ $group: { _id: "$_id.tripId", deviations: { $push: "$best" } } });
    // The element at floor(n / 2) of the sorted readings, as medianDeviation picks.
    expect(level).toEqual({
      $project: {
        _id: 1,
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
});
