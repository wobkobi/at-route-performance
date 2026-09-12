// src/lib/ghost-pass.ts
// Nightly classification of a completed service day's arrival events into real
// readings and ghost re-reports (AT reusing a `trip_id` against a later vehicle
// block). Ingest stores every reading as reported, so this is what keeps the
// noise out of the stats without a magnitude cut deleting the worst genuine
// delays along with it - see deviation.ts for the rule.
//
// Runs entirely off the `(scheduledAt, tripId)` index: one aggregation reduces
// the day to a level per trip, then batched multi-updates rewrite each trip's
// `ghost` flag from that level. Nothing is deleted, every row of a trip is
// re-decided in the same write, and a re-run reaches the same verdicts, so the
// pass is idempotent without ever clearing a day's flags first.
import { prisma, runCommand } from "@/lib/db";
import { GHOST_GAP_SEC } from "@/lib/deviation";
import type { DateRange } from "@/lib/time";
import type { Prisma } from "@prisma/client";

/** Trips per bulk `update` command (well under Mongo's 1000-op cap). */
export const UPDATE_BATCH = 500;

/**
 * Rows the level aggregation may return in one batch. A day holds a few tens
 * of thousands of trips at roughly sixty bytes each, far under the 16 MB reply
 * limit; the pass refuses a reply that fills the batch rather than classify a
 * silently truncated day.
 */
const LEVEL_BATCH_SIZE = 100_000;

/**
 * A `scheduledAt` window in extended JSON, as raw commands take it. A type
 * alias rather than an interface so it satisfies the JSON shape raw commands
 * accept (interfaces carry no implicit index signature).
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- needs the implicit index signature
export type BsonWindow = {
  $gte: { $date: string };
  $lt: { $date: string };
};

/** One trip's run level for the day. */
export interface TripLevel {
  tripId: string;
  /** Median of the trip's best reading per stop, in seconds. */
  level: number;
}

/** One entry of a bulk `update` command (an alias, see {@link BsonWindow}). */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- needs the implicit index signature
export type GhostUpdateOp = {
  q: Prisma.InputJsonObject;
  u: Prisma.InputJsonObject[];
  multi: true;
};

/** What a pass did, for the ingest log. */
export interface GhostPassResult {
  /** Trips examined. */
  trips: number;
  /** Event rows carrying a ghost flag once the pass finished. */
  flagged: number;
}

/**
 * The window a service day's rows fall in, in extended JSON.
 * @param range - The service-day window.
 * @returns The `$gte`/`$lt` bounds.
 */
export function bsonWindow(range: DateRange): BsonWindow {
  return { $gte: { $date: range.start.toISOString() }, $lt: { $date: range.end.toISOString() } };
}

/**
 * Pipeline stages reducing arrival rows to one level per trip. Each stop
 * contributes only its reading nearest that stop's own schedule, so a stop
 * carrying both a real arrival and a ghost re-report contributes the real one
 * (`$top` keeps the signed value while ranking on magnitude; a plain `$min`
 * would return the magnitude and read a uniformly early run as a late one).
 * The level is the exact median of those per-stop readings, the element at
 * `floor(n / 2)` of the sorted list, which is the same element
 * `medianDeviation` in deviation.ts picks for the in-memory path, so the two
 * paths agree on a run's level. Platforms are grouped by stop rather than by
 * station: a ghost sits a whole vehicle cycle off the run, so it clears the gap
 * from either platform, and grouping by stop keeps the pass off the Stop
 * collection entirely. Exported without the `$match` so a test can feed the
 * stages synthetic rows through `$documents`.
 * @returns The stages, to follow a `$match` on the day.
 */
export function ghostLevelStages(): Prisma.InputJsonObject[] {
  return [
    { $addFields: { absDev: { $abs: "$deviationSec" } } },
    {
      $group: {
        _id: { tripId: "$tripId", stopId: "$stopId" },
        best: { $top: { sortBy: { absDev: 1 }, output: "$deviationSec" } },
      },
    },
    { $group: { _id: "$_id.tripId", deviations: { $push: "$best" } } },
    {
      $project: {
        _id: 1,
        level: {
          $arrayElemAt: [
            { $sortArray: { input: "$deviations", sortBy: 1 } },
            { $toInt: { $floor: { $divide: [{ $size: "$deviations" }, 2] } } },
          ],
        },
      },
    },
  ];
}

/**
 * The full level aggregation for one service day.
 * @param window - The day's `scheduledAt` window.
 * @returns The pipeline.
 */
export function ghostPassPipeline(window: BsonWindow): Prisma.InputJsonObject[] {
  return [{ $match: { scheduledAt: window } }, ...ghostLevelStages()];
}

/**
 * The bulk-update entries that rewrite a trip's flags from its level: every
 * row of the trip in the window is decided in one multi-update, `ghost: true`
 * when it sits more than {@link GHOST_GAP_SEC} off the level (exclusive, as
 * `isGhostDeviation` is) and the field removed otherwise. Rewriting both ways
 * in one write is what makes a re-run safe with no clearing step, and keeps
 * every trip's rows consistent with each other at any instant. Batched at
 * {@link UPDATE_BATCH} trips per command.
 * @param levels - The day's trip levels.
 * @param window - The day's `scheduledAt` window.
 * @returns The update batches, in trip order.
 */
export function ghostUpdateBatches(
  levels: readonly TripLevel[],
  window: BsonWindow,
): GhostUpdateOp[][] {
  const ops = levels.map(({ tripId, level }): GhostUpdateOp => ({
    q: { tripId, scheduledAt: window },
    u: [
      {
        $set: {
          ghost: {
            $cond: [
              {
                $or: [
                  { $gt: ["$deviationSec", level + GHOST_GAP_SEC] },
                  { $lt: ["$deviationSec", level - GHOST_GAP_SEC] },
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
  }));
  const batches: GhostUpdateOp[][] = [];
  for (let i = 0; i < ops.length; i += UPDATE_BATCH) batches.push(ops.slice(i, i + UPDATE_BATCH));
  return batches;
}

/** The parts of a bulk `update` reply the pass reads. */
interface UpdateReply {
  writeErrors?: { index: number; code: number; errmsg: string }[];
}

/**
 * Flag the ghost readings in a completed service day.
 * @param range - The service-day window to classify.
 * @param collection - The events collection (a test points this at a scratch one).
 * @returns Counts of trips examined and rows flagged.
 */
export async function classifyGhosts(
  range: DateRange,
  collection = "ArrivalEvent",
): Promise<GhostPassResult> {
  const window = bsonWindow(range);

  const res = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: collection,
      pipeline: ghostPassPipeline(window),
      cursor: { batchSize: LEVEL_BATCH_SIZE },
    }),
  )) as unknown as { cursor: { firstBatch: { _id: string; level: number }[] } };
  if (res.cursor.firstBatch.length >= LEVEL_BATCH_SIZE) {
    throw new Error(
      `ghost pass: the day holds ${LEVEL_BATCH_SIZE} or more trips, more than one batch returns`,
    );
  }
  const levels: TripLevel[] = res.cursor.firstBatch.map((t) => ({ tripId: t._id, level: t.level }));

  // One multi-update per trip, batched, so a day costs tens of round-trips
  // rather than thousands. A batch continues past a failed entry (`ordered:
  // false`), so the reply's write errors are checked rather than the promise.
  for (const updates of ghostUpdateBatches(levels, window)) {
    const out = (await runCommand(() =>
      prisma.$runCommandRaw({ update: collection, updates, ordered: false }),
    )) as unknown as UpdateReply;
    const [first] = out.writeErrors ?? [];
    if (first) {
      throw new Error(
        `ghost pass: ${out.writeErrors?.length ?? 0} update(s) failed, first: ${first.errmsg}`,
      );
    }
  }

  // The update reply counts rows changed either way, so the flagged total is
  // read back: one count over the day's window.
  const counted = (await runCommand(() =>
    prisma.$runCommandRaw({ count: collection, query: { scheduledAt: window, ghost: true } }),
  )) as unknown as { n?: number };

  return { trips: levels.length, flagged: counted.n ?? 0 };
}
