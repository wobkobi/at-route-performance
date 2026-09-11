// src/lib/ghost-pass.ts
/**
 * @description Nightly classification of a completed service day's arrival
 * events into real readings and ghost re-reports (AT reusing a `trip_id` against
 * a later vehicle block). Ingest stores every reading as reported, so this is
 * what keeps the noise out of the stats without a magnitude cut deleting the
 * worst genuine delays along with it - see deviation.ts for the rule.
 *
 * Runs entirely off the `(scheduledAt, tripId)` index: one aggregation to reduce
 * the day to a level per trip, then batched multi-updates to flag the outliers.
 * Nothing is deleted, and a re-run for the same day starts by clearing its flags,
 * so the pass is idempotent.
 */
import { prisma, runCommand } from "@/lib/db";
import { GHOST_GAP_SEC, medianDeviation } from "@/lib/deviation";
import type { DateRange } from "@/lib/time";

/** Trips per bulk `update` command (well under Mongo's 1000-op cap). */
const UPDATE_BATCH = 500;

/**
 * One trip's readings for the day, reduced to the best reading per stop by the
 * aggregation, so the level is computed over places rather than over polls.
 */
interface TripBestReadings {
  _id: string;
  deviations: number[];
}

/** What a pass did, for the ingest log. */
export interface GhostPassResult {
  /** Trips examined. */
  trips: number;
  /** Event rows flagged as ghosts. */
  flagged: number;
}

/**
 * Flag the ghost readings in a completed service day.
 *
 * Platforms are grouped by stop rather than by station: a ghost sits a whole
 * vehicle cycle off the run, so it clears the gap from either platform, and
 * grouping by stop keeps the pass off the Stop collection entirely.
 * @param range - The service-day window to classify.
 * @returns Counts of trips examined and rows flagged.
 */
export async function classifyGhosts(range: DateRange): Promise<GhostPassResult> {
  const window = {
    $gte: { $date: range.start.toISOString() },
    $lt: { $date: range.end.toISOString() },
  };

  // Clear the day's flags first so a re-run reclassifies from scratch rather
  // than leaving yesterday's verdict on a row this pass would now keep.
  await runCommand(() =>
    prisma.$runCommandRaw({
      update: "ArrivalEvent",
      updates: [
        { q: { scheduledAt: window, ghost: true }, u: { $unset: { ghost: "" } }, multi: true },
      ],
      ordered: false,
    }),
  );

  // Reduce the day to one reading per (trip, stop) - the one nearest that stop's
  // own schedule, so a stop carrying both a real arrival and a ghost re-report
  // contributes the real one - then collect those per trip. `$top` keeps the
  // signed value while ranking on magnitude; a plain `$min` would return the
  // magnitude and read a uniformly early run as a late one.
  const res = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: [
        { $match: { scheduledAt: window } },
        { $addFields: { absDev: { $abs: "$deviationSec" } } },
        {
          $group: {
            _id: { tripId: "$tripId", stopId: "$stopId" },
            best: { $top: { sortBy: { absDev: 1 }, output: "$deviationSec" } },
          },
        },
        { $group: { _id: "$_id.tripId", deviations: { $push: "$best" } } },
      ] as never,
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as { cursor: { firstBatch: TripBestReadings[] } };

  // A trip's level is the median of those per-stop readings.
  const levels: { tripId: string; level: number }[] = [];
  for (const t of res.cursor.firstBatch) {
    const level = medianDeviation(t.deviations);
    if (level !== null) levels.push({ tripId: t._id, level });
  }

  // Flag anything sitting more than a vehicle cycle off its run. One multi-update
  // per trip, batched, so a day costs tens of round-trips rather than thousands.
  let flagged = 0;
  for (let i = 0; i < levels.length; i += UPDATE_BATCH) {
    const updates = levels.slice(i, i + UPDATE_BATCH).map(({ tripId, level }) => ({
      q: {
        tripId,
        scheduledAt: window,
        $or: [
          { deviationSec: { $gt: level + GHOST_GAP_SEC } },
          { deviationSec: { $lt: level - GHOST_GAP_SEC } },
        ],
      },
      u: { $set: { ghost: true } },
      multi: true,
    }));
    const out = (await runCommand(() =>
      prisma.$runCommandRaw({
        update: "ArrivalEvent",
        updates: updates,
        ordered: false,
      }),
    )) as unknown as { nModified?: number };
    flagged += out.nModified ?? 0;
  }

  return { trips: levels.length, flagged };
}
