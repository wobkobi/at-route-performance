// tests/lib/arrival-write.int.test.ts
// Replays AT's block reuse through arrivalWriteStages against MongoDB on a
// scratch collection. The unit tests pin the pipeline that is emitted; this pins
// what Mongo does with it - which reading survives a contested visit, that a
// fresh visit is built on the upsert path, and that the run's own service date
// rides the take and not the refusal. Needs DATABASE_URL: `npm run test:int`.
import { prisma } from "@/lib/db";
import { type ArrivalWrite, arrivalWriteStages } from "@/lib/deviation";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const COLLECTION = "_audit_arrival_write";

/** The one stop visit every case contests: one trip, one stop, one scheduled time. */
const KEY = {
  tripId: "1108-15203-78300-2-58ac9d51",
  stopId: "5276-8a7a52df",
  scheduledAt: { $date: "2026-09-14T09:50:00.000Z" },
};

/** The scheduled instant of {@link KEY}, for building each reading's arrival. */
const SCHEDULED_MS = Date.parse("2026-09-14T09:50:00.000Z");

/** One stored row, as the cases read it back. */
interface StoredRow {
  routeId?: string;
  deviationSec?: number;
  vehicleId?: string;
  source?: string;
  serviceDate?: string;
  blockReuse?: boolean;
  actualAt?: unknown;
}

/**
 * Apply one incoming reading to the scratch visit, exactly as the ingest upsert
 * does: the same query, the same pipeline, the same `upsert: true`.
 * @param doc - The incoming arrival values.
 */
async function apply(doc: ArrivalWrite): Promise<void> {
  await prisma.$runCommandRaw({
    update: COLLECTION,
    updates: [{ q: KEY, u: arrivalWriteStages(doc), upsert: true }] as never,
    ordered: false,
  });
}

/** Empty the scratch collection between cases. */
async function clear(): Promise<void> {
  await prisma
    .$runCommandRaw({ delete: COLLECTION, deletes: [{ q: {}, limit: 0 }] })
    .catch(() => undefined);
}

/**
 * The stored row for the scratch visit.
 * @returns The row, or null when nothing is stored.
 */
async function stored(): Promise<StoredRow | null> {
  const res = (await prisma.$runCommandRaw({
    find: COLLECTION,
    filter: KEY,
    projection: { _id: 0 },
  })) as unknown as { cursor: { firstBatch: StoredRow[] } };
  return res.cursor.firstBatch[0] ?? null;
}

/**
 * One incoming reading from a named vehicle.
 * @param vehicleId - The reporting vehicle, or undefined when the poll named none.
 * @param deviationSec - Signed deviation in seconds.
 * @param extra - Fields the case overrides.
 * @returns The incoming arrival values.
 */
function reading(
  vehicleId: string | undefined,
  deviationSec: number,
  extra: Partial<ArrivalWrite> = {},
): ArrivalWrite {
  return {
    routeId: "152-203",
    actualAtMs: SCHEDULED_MS + deviationSec * 1000,
    deviationSec,
    vehicleId,
    source: "AT_GTFSRT",
    serviceDate: "2026-09-14",
    ...extra,
  };
}

/**
 * An extended-JSON date from a raw reply as an ISO string. A raw command answers
 * a BSON date as `{ $date }`, whose payload is a string on some driver versions
 * and a `$numberLong` on others.
 * @param v - The raw field value.
 * @returns The instant as an ISO string.
 */
function isoOf(v: unknown): string {
  if (typeof v === "string") return new Date(v).toISOString();
  const d = (v as { $date?: unknown }).$date;
  if (typeof d === "string") return new Date(d).toISOString();
  return new Date(Number((d as { $numberLong: string }).$numberLong)).toISOString();
}

describe("arrivalWriteStages on MongoDB", () => {
  beforeAll(async () => {
    await prisma.$runCommandRaw({ drop: COLLECTION }).catch(() => undefined);
  });

  beforeEach(clear);

  afterAll(async () => {
    await prisma.$runCommandRaw({ drop: COLLECTION }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("keeps the reading nearer the stop's own schedule, either order", async () => {
    // The worked example from 2026-09-14: 22098 runs the 21:45, and 22097
    // reports the same visit a cycle away on a reused id.
    await apply(reading("22098", -129));
    await apply(reading("22097", 3646));
    expect(await stored()).toMatchObject({
      vehicleId: "22098",
      deviationSec: -129,
      blockReuse: true,
    });

    await clear();
    await apply(reading("22097", 3646));
    await apply(reading("22098", -129));
    expect(await stored()).toMatchObject({
      vehicleId: "22098",
      deviationSec: -129,
      blockReuse: true,
    });
  });

  it("refuses a block signed on an hour ahead as readily as one an hour behind", async () => {
    // 1113-11404-51960-2-c90ec64e on 2026-09-14: 44012 runs it, 47475 reports
    // from a block a full cycle early.
    await apply(reading("44012", 23));
    await apply(reading("47475", -3774));
    expect(await stored()).toMatchObject({
      vehicleId: "44012",
      deviationSec: 23,
      blockReuse: true,
    });
  });

  it("lets the same vehicle revise its own prediction however far it moves", async () => {
    // The regression a magnitude-only rule causes: one bus, predicted on time,
    // arriving an hour late. The late reading is the truth and must survive.
    await apply(reading("22105", 60));
    await apply(reading("22105", 3600));
    const row = await stored();
    expect(row).toMatchObject({ vehicleId: "22105", deviationSec: 3600 });
    expect(row).not.toHaveProperty("blockReuse");
  });

  it("takes the last write when either side names no vehicle, and erases nothing", async () => {
    await apply(reading("22098", -129));
    await apply(reading(undefined, 3646, { source: undefined }));
    const row = await stored();
    // Last write wins, and the $$REMOVE trap: the stored vehicle and source
    // survive a poll that omitted them.
    expect(row).toMatchObject({ deviationSec: 3646, vehicleId: "22098", source: "AT_GTFSRT" });
    expect(row).not.toHaveProperty("blockReuse");
  });

  it("builds a fresh document on the upsert path with no blockReuse", async () => {
    await apply(reading("22098", -129));
    const row = await stored();
    expect(row).toMatchObject({
      routeId: "152-203",
      deviationSec: -129,
      vehicleId: "22098",
      source: "AT_GTFSRT",
    });
    expect(row).not.toHaveProperty("blockReuse");
    expect(row).not.toHaveProperty("_reuse");
    expect(row).not.toHaveProperty("_take");
  });

  it("round-trips actualAt as a BSON date through the conversion", async () => {
    await apply(reading("22098", -129));
    const row = await stored();
    expect(typeof row?.actualAt).not.toBe("number");
    expect(isoOf(row?.actualAt)).toBe(new Date(SCHEDULED_MS - 129_000).toISOString());
  });

  it("carries the run's service date on the take side and not on the refusal", async () => {
    // The branch the design spec's own listing of arrivalWriteStages omits. The
    // refused reading belongs to the next day's run on a reused id; taking its
    // date would file this row under a day it has no reading in.
    await apply(reading("22098", -129, { serviceDate: "2026-09-14" }));
    await apply(reading("22097", 3646, { serviceDate: "2026-09-15" }));
    expect(await stored()).toMatchObject({
      vehicleId: "22098",
      serviceDate: "2026-09-14",
      blockReuse: true,
    });
  });

  it("corrects the stored service date on an ordinary revision", async () => {
    await apply(reading("22098", -129, { serviceDate: "2026-09-13" }));
    await apply(reading("22098", -60, { serviceDate: "2026-09-14" }));
    expect(await stored()).toMatchObject({ deviationSec: -60, serviceDate: "2026-09-14" });
  });
});
