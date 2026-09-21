// tests/lib/ghost-pass.int.test.ts
// Runs the nightly ghost pass against MongoDB on a scratch collection: proves
// the level stages pick the exact median of each stop's best reading, that the
// per-trip rewrite flags outliers and clears stale flags in one write, and that
// a re-run is idempotent. Needs DATABASE_URL: `npm run test:int`.
import { prisma } from "@/lib/db";
import { GHOST_GAP_SEC } from "@/lib/deviation";
import { classifyGhosts, ghostLevelStages } from "@/lib/ghost-pass";
import { nzServiceDayRange, serviceDayClockInstant } from "@/lib/time";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const COLLECTION = "_audit_ghost_pass";
const RUN_RECORDS = "_audit_ghost_run_records";
const RUN_META = "_audit_ghost_run_meta";
const DAY = "2026-09-11";
const range = nzServiceDayRange(DAY);
const TARGET = { events: COLLECTION, runs: RUN_RECORDS, meta: RUN_META };

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
    const result = await classifyGhosts(range, DAY, TARGET);
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
    const result = await classifyGhosts(range, DAY, TARGET);
    expect(result).toEqual({ trips: 2, flagged: 2, hidden: 0 });
    expect(await readBack()).toEqual(before);
  });
});

const RUN_EVENTS = "_audit_ghost_run_events";
const RUN_DAY = "2026-09-14";
const runRange = nzServiceDayRange(RUN_DAY);
const RUN_TARGET = { events: RUN_EVENTS, runs: RUN_RECORDS, meta: RUN_META };

/**
 * An arrival row inside the whole-run test day, placed by its GTFS clock time.
 * @param tripId - Trip id.
 * @param stopId - Stop id.
 * @param clockSec - Seconds past the GTFS reference for `scheduledAt`.
 * @param deviationSec - Signed deviation.
 * @param vehicleId - The reporting vehicle.
 * @returns The document in extended JSON.
 */
function runRow(
  tripId: string,
  stopId: string,
  clockSec: number,
  deviationSec: number,
  vehicleId: string,
): Prisma.InputJsonObject {
  const at = serviceDayClockInstant(runRange.start, clockSec);
  return {
    routeId: "R-1",
    tripId,
    stopId,
    scheduledAt: { $date: at.toISOString() },
    actualAt: { $date: new Date(at.getTime() + deviationSec * 1000).toISOString() },
    deviationSec,
    vehicleId,
    serviceDate: RUN_DAY,
  };
}

// Case 13: the post-Fix-1 shape of 1108-15203-78300-2-58ac9d51 - eleven readings
// from the real bus and five strays. The same rows without Fix 1's guard produce
// a level of about 3375 and flag the real four; with it the level is negative and
// exactly the five strays are flagged, which is what pins the inversion.
const REAL_152 = [-60, -95, -128, -160, -190, -220, -255, -290, -320, -345, -363];
const STRAY_152 = [3237, 3387, 3424, 3543, 3607];

// Case 14: a post-guard shape for 1027-03207-45600-2-9a9269d6 - eleven readings
// from the real bus against six surviving strays. The eleven-to-six split is a
// reconstruction, so the case asserts the counts it seeds, never a figure read
// back from production.
const REAL_32 = [-345, -300, -255, -210, -160, -110, -60, -10, 40, 90, 128];
const STRAY_32 = [3300, 3360, 3420, 3480, 3540, 3600];

// Case 15: the one whole-ghost run in the data. Start 58560 (16:16), three
// readings whose earliest stored schedule is 17:16 - a full cycle away.
const GHOST_TRIP = "1155-71203-58560-2-528ac570";
const GHOST_ROWS = [
  runRow(GHOST_TRIP, "g1", 62_160, -5742, "26207"),
  runRow(GHOST_TRIP, "g2", 62_460, -5822, "26207"),
  runRow(GHOST_TRIP, "g3", 62_760, -5792, "26207"),
];

const RUN_DOCS: Prisma.InputJsonObject[] = [
  ...REAL_152.map((d, i) =>
    runRow("1108-15203-78300-2-58ac9d51", `r${i}`, 78_300 + i * 120, d, "22098"),
  ),
  ...STRAY_152.map((d, i) =>
    runRow("1108-15203-78300-2-58ac9d51", `s${i}`, 79_620 + i * 120, d, "22097"),
  ),
  ...REAL_32.map((d, i) =>
    runRow("1027-03207-45600-2-9a9269d6", `t${i}`, 45_600 + i * 120, d, "47460"),
  ),
  ...STRAY_32.map((d, i) =>
    runRow("1027-03207-45600-2-9a9269d6", `u${i}`, 46_920 + i * 120, d, "47451"),
  ),
  ...GHOST_ROWS,
];

/**
 * Read the whole-run scratch collection back.
 * @returns The rows, keyed for comparison.
 */
async function readRunRows(): Promise<{ tripId: string; stopId: string; ghost?: boolean }[]> {
  const res = (await prisma.$runCommandRaw({
    find: RUN_EVENTS,
    projection: { _id: 0, tripId: 1, stopId: 1, ghost: 1 },
    sort: { tripId: 1, stopId: 1 },
  })) as unknown as {
    cursor: { firstBatch: { tripId: string; stopId: string; ghost?: boolean }[] };
  };
  return res.cursor.firstBatch;
}

/**
 * Read the recorded hidden runs back.
 * @returns The GhostRun rows for the test day.
 */
async function readRunRecords(): Promise<
  { tripId: string; evidence: string[]; belongsToTripId: string | null; readings: number }[]
> {
  const res = (await prisma.$runCommandRaw({
    find: RUN_RECORDS,
    projection: { _id: 0 },
    sort: { tripId: 1 },
  })) as unknown as {
    cursor: {
      firstBatch: {
        tripId: string;
        evidence: string[];
        belongsToTripId: string | null;
        readings: number;
      }[];
    };
  };
  return res.cursor.firstBatch;
}

describe("the whole-run rule on MongoDB", () => {
  beforeAll(async () => {
    for (const c of [RUN_EVENTS, RUN_RECORDS, RUN_META]) {
      await prisma.$runCommandRaw({ drop: c }).catch(() => undefined);
    }
    await prisma.$runCommandRaw({ insert: RUN_EVENTS, documents: RUN_DOCS });
    // Both slots before the whole-ghost run are in its block, and neither
    // reported here. The nearer one sits within SIBLING_GAP_SEC of the readings'
    // physical time, but no reporting trip of its pattern proves that pattern
    // ran, so the sibling test names nothing and belongsToTripId stays null -
    // which is every instance in the data so far.
    await prisma.$runCommandRaw({
      insert: RUN_META,
      documents: [
        { _id: "1155-71203-53160-2-20f1f50c" },
        { _id: "1155-71203-56760-2-528ac570" },
        { _id: GHOST_TRIP },
      ],
    });
  });

  afterAll(async () => {
    for (const c of [RUN_EVENTS, RUN_RECORDS, RUN_META]) {
      await prisma.$runCommandRaw({ drop: c }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("flags the strays and keeps the real run, rather than inverting it", async () => {
    const result = await classifyGhosts(runRange, RUN_DAY, RUN_TARGET);
    expect(result.trips).toBe(3);
    expect(result.hidden).toBe(1);

    const rows = await readRunRows();
    const trip152 = rows.filter((r) => r.tripId === "1108-15203-78300-2-58ac9d51");
    expect(trip152.filter((r) => r.ghost === true).map((r) => r.stopId)).toEqual(
      STRAY_152.map((_, i) => `s${i}`),
    );
    const real152 = trip152.filter((r) => r.stopId.startsWith("r"));
    expect(real152).toHaveLength(REAL_152.length);
    expect(real152.every((r) => r.ghost !== true)).toBe(true);
  });

  it("flags only the reconstructed strays on the route 32 run", async () => {
    const rows = await readRunRows();
    const flagged = rows.filter(
      (r) => r.tripId === "1027-03207-45600-2-9a9269d6" && r.ghost === true,
    );
    expect(flagged.map((r) => r.stopId)).toEqual(STRAY_32.map((_, i) => `u${i}`));
  });

  it("hides every reading of the whole-ghost run and records why", async () => {
    const rows = await readRunRows();
    expect(rows.filter((r) => r.tripId === GHOST_TRIP).every((r) => r.ghost === true)).toBe(true);
    expect(await readRunRecords()).toEqual([
      expect.objectContaining({
        tripId: GHOST_TRIP,
        evidence: ["anchor"],
        belongsToTripId: null,
        readings: 3,
      }),
    ]);
  });

  it("reaches the same verdicts and keeps one record on a re-run", async () => {
    const before = await readRunRows();
    const result = await classifyGhosts(runRange, RUN_DAY, RUN_TARGET);
    expect(result).toEqual({
      trips: 3,
      flagged: STRAY_152.length + STRAY_32.length + 3,
      hidden: 1,
    });
    expect(await readRunRows()).toEqual(before);
    expect(await readRunRecords()).toHaveLength(1);
  });
});
