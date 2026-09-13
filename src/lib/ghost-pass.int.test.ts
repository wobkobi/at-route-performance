// src/lib/ghost-pass.int.test.ts
// Runs the nightly ghost pass against MongoDB on a scratch collection: proves
// the level stages pick the exact median of each stop's best reading, that the
// per-trip rewrite flags outliers and clears stale flags in one write, and that
// a re-run is idempotent. Needs DATABASE_URL: `npm run test:int`.
import { prisma } from "@/lib/db";
import { GHOST_GAP_SEC } from "@/lib/deviation";
import { classifyGhosts, ghostLevelStages } from "@/lib/ghost-pass";
import { nzServiceDayRange } from "@/lib/time";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const COLLECTION = "_audit_ghost_pass";
const DAY = "2026-09-11";
const range = nzServiceDayRange(DAY);

/**
 * An arrival row inside the test day.
 * @param tripId - Trip id.
 * @param stopId - Stop id.
 * @param minute - Minutes after the day's start for `scheduledAt`.
 * @param deviationSec - Signed deviation.
 * @param extra - Extra fields, such as a stale `ghost` flag.
 * @returns The document in extended JSON.
 */
function row(
  tripId: string,
  stopId: string,
  minute: number,
  deviationSec: number,
  extra: Prisma.InputJsonObject = {},
): Prisma.InputJsonObject {
  const at = new Date(range.start.getTime() + minute * 60_000);
  return {
    routeId: "R-1",
    tripId,
    stopId,
    scheduledAt: { $date: at.toISOString() },
    actualAt: { $date: new Date(at.getTime() + deviationSec * 1000).toISOString() },
    deviationSec,
    ...extra,
  };
}

// Trip A runs about a minute late; stop s3 also carries a ghost re-report an
// hour off, s5 carries a stale flag from an earlier verdict that this pass must
// clear, s6 sits one second outside the gap and s7 exactly on it (the gap is
// exclusive). Trip B is a uniformly early run whose level must stay negative.
// Trip Z sits on the previous day and must not be touched.
const DOCS = [
  row("A", "s1", 600, 55),
  row("A", "s2", 605, 60),
  row("A", "s3", 610, 62),
  row("A", "s3", 610, 3662),
  row("A", "s4", 615, 65),
  row("A", "s5", 620, 70, { ghost: true }),
  row("A", "s6", 625, 65 + GHOST_GAP_SEC + 1),
  row("A", "s7", 630, 65 + GHOST_GAP_SEC),
  row("B", "s1", 700, -120),
  row("B", "s2", 705, -100),
  row("B", "s3", 710, -110),
  row("Z", "s1", -30, 0, { ghost: true }),
];

/**
 * Read the scratch collection back as `{ tripId, stopId, deviationSec, ghost }`.
 * @returns The rows, sorted by trip, stop and deviation.
 */
async function readBack(): Promise<
  { tripId: string; stopId: string; deviationSec: number; ghost?: boolean }[]
> {
  const res = (await prisma.$runCommandRaw({
    find: COLLECTION,
    projection: { _id: 0, tripId: 1, stopId: 1, deviationSec: 1, ghost: 1 },
    sort: { tripId: 1, stopId: 1, deviationSec: 1 },
  })) as unknown as {
    cursor: {
      firstBatch: { tripId: string; stopId: string; deviationSec: number; ghost?: boolean }[];
    };
  };
  return res.cursor.firstBatch;
}

describe("ghost pass on MongoDB", () => {
  beforeAll(async () => {
    await prisma.$runCommandRaw({ drop: COLLECTION }).catch(() => undefined);
    await prisma.$runCommandRaw({ insert: COLLECTION, documents: DOCS });
  });

  afterAll(async () => {
    await prisma.$runCommandRaw({ drop: COLLECTION }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("takes each stop's reading nearest its schedule and the exact median per trip", async () => {
    const res = (await prisma.$runCommandRaw({
      aggregate: 1,
      pipeline: [{ $documents: DOCS.filter((d) => d.tripId !== "Z") }, ...ghostLevelStages()],
      cursor: {},
    })) as unknown as { cursor: { firstBatch: { _id: string; level: number }[] } };
    const levels = new Map(res.cursor.firstBatch.map((r) => [r._id, r.level]));
    // A: best per stop = [55, 60, 62, 65, 70, 2765, 2766] sorted; index 3 is 65.
    expect(levels.get("A")).toBe(65);
    // B: [-120, -110, -100]; index 1 is -110, still negative.
    expect(levels.get("B")).toBe(-110);
  });

  it("flags the outliers, clears the stale flag and leaves other days alone", async () => {
    const result = await classifyGhosts(range, COLLECTION);
    expect(result.trips).toBe(2);
    expect(result.flagged).toBe(2);

    const rows = await readBack();
    const flagged = rows
      .filter((r) => r.ghost === true)
      .map((r) => `${r.tripId}/${r.stopId}/${r.deviationSec}`);
    expect(flagged).toEqual(["A/s3/3662", `A/s6/${65 + GHOST_GAP_SEC + 1}`, "Z/s1/0"]);
    expect(rows.find((r) => r.tripId === "A" && r.stopId === "s5")).not.toHaveProperty("ghost");
    expect(rows.find((r) => r.tripId === "A" && r.stopId === "s7")).not.toHaveProperty("ghost");
    expect(rows.filter((r) => r.tripId === "B").every((r) => r.ghost === undefined)).toBe(true);
  });

  it("reaches the same verdicts on a re-run", async () => {
    const before = await readBack();
    const result = await classifyGhosts(range, COLLECTION);
    expect(result).toEqual({ trips: 2, flagged: 2 });
    expect(await readBack()).toEqual(before);
  });
});
