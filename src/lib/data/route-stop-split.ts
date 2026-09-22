// A route's per-stop arrival sums split by the direction, shape and headsign of each run, for the
// route diagram's two figure columns and its version chips. ArrivalEvent carries none of those,
// so each reading is joined to its run's TripMeta row. Folded into figures by lib/stop-split.ts.
import { cachedForRange, scheduledAtWindow } from "@/lib/data/cache";
import { routeIdsForSlug } from "@/lib/data/routes";
import { prisma, runCommand } from "@/lib/db";
import { realDeviationMatchFor } from "@/lib/deviation";
import { onTimeSingleModeSum } from "@/lib/on-time";
import type { StopSplitRow } from "@/lib/stop-split";
import type { DateRange } from "@/lib/time";

/**
 * Run the split aggregation for one route over one window. The join runs per reading, so this
 * stays a single-route query: about 0.1s for a route-day of 3,000 arrivals, against 17ms for
 * the unsplit per-stop group.
 * @param slug - Route slug; every version's route id is read.
 * @param range - The window.
 * @param mode - The route's mode, for its on-time window.
 * @param classified - Whether every day in the window has been through the ghost pass.
 * @returns One row per stop, direction, shape and headsign.
 */
async function queryRouteStopSplit(
  slug: string,
  range: DateRange,
  mode: string,
  classified: boolean,
): Promise<StopSplitRow[]> {
  const routeIds = await routeIdsForSlug(slug);
  const result = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: [
        {
          $match: {
            routeId: { $in: routeIds },
            scheduledAt: scheduledAtWindow(range),
            ...realDeviationMatchFor(classified),
          },
        },
        {
          $lookup: {
            from: "tripMeta",
            localField: "tripId",
            foreignField: "_id",
            as: "meta",
            pipeline: [{ $project: { directionId: 1, shapeId: 1, headsign: 1 } }],
          },
        },
        { $set: { meta: { $first: "$meta" } } },
        {
          $group: {
            _id: {
              stop: "$stopId",
              dir: "$meta.directionId",
              shape: "$meta.shapeId",
              head: "$meta.headsign",
            },
            events: { $sum: 1 },
            dev_sum: { $sum: "$deviationSec" },
            on_time: onTimeSingleModeSum(mode),
          },
        },
        {
          $project: {
            _id: 0,
            stop_id: { $toString: "$_id.stop" },
            direction_id: { $ifNull: ["$_id.dir", null] },
            shape_id: { $ifNull: ["$_id.shape", null] },
            headsign: { $ifNull: ["$_id.head", null] },
            events: 1,
            dev_sum: 1,
            on_time: 1,
          },
        },
      ],
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as { cursor: { firstBatch: StopSplitRow[] } };
  return result.cursor.firstBatch;
}

/**
 * A route's per-stop sums split by run, cached like the route's other day figures: a finished
 * day holds for a week, today turns over with each ingest run.
 * @param slug - Route slug.
 * @param range - The window, one service day on the route page.
 * @param mode - The route's mode.
 * @returns The rows, for `splitStopFigures`.
 */
export function getRouteStopSplit(
  slug: string,
  range: DateRange,
  mode: string,
): Promise<StopSplitRow[]> {
  return cachedForRange(
    (classified) => queryRouteStopSplit(slug, range, mode, classified),
    ["route-stop-split", slug, range.start.toISOString(), range.end.toISOString(), mode],
    range,
    300,
  );
}
