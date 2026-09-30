// src/lib/data/live-stored.ts
// Which trips in the live feed have any history stored. A trip the realtime
// ingest has never written an arrival for - every trip of a route new to the
// feed (MEX, say), or one run whose operator sends no trip updates - leaves its
// trip page empty, so the map does not draw it.

import { prisma, runCommand } from "@/lib/db";
import { getLiveVehicles } from "@/lib/feed/vehicles";
import { onARun } from "@/lib/live-routes";
import { unstable_cache } from "@/lib/mem-cache";

/**
 * The trip ids of live runs with at least one arrival on record, on any day.
 * Cached for the feed's own two minutes, so every viewer's poll shares one
 * lookup. Grouping on `tripId` alone after a match on it lets the server walk
 * the `(tripId, stopId, scheduledAt)` index with a distinct scan: it reads about
 * one key per trip, not a row per stop per day, and no documents.
 * @returns The live trip ids with history.
 */
export async function getRecordedLiveTrips(): Promise<Set<string>> {
  const ids = await unstable_cache(
    async () => {
      const trips = [...new Set(onARun(await getLiveVehicles()).map((v) => v.tripId as string))];
      if (trips.length === 0) return [];
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [{ $match: { tripId: { $in: trips } } }, { $group: { _id: "$tripId" } }],
          cursor: { batchSize: 10_000 },
        }),
      )) as unknown as { cursor: { firstBatch: { _id: string }[] } };
      return res.cursor.firstBatch.map((r) => r._id);
    },
    ["live-recorded-trips"],
    { revalidate: 120 },
  )();
  return new Set(ids);
}
