// Helpers for Prisma's raw Mongo commands: running an aggregation, and the
// extended-JSON dates the commands take and return. A leaf module (only the
// client and the time types), so the cron passes can use it without importing
// the cache policy and, through it, the ingest loop that imports them.
import { prisma, runCommand } from "@/lib/db";
import type { DateRange } from "@/lib/time/service-day";

/** A date as `$runCommandRaw` returns it: extended JSON (`{ $date }`) or an ISO string. */
export type BsonDate = { $date: string } | string;

/**
 * A date window in extended JSON, as raw commands take it. A type alias rather
 * than an interface so it satisfies the JSON shape raw commands accept
 * (interfaces carry no implicit index signature).
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- needs the implicit index signature
export type BsonWindow = {
  $gte: { $date: string };
  $lt: { $date: string };
};

/**
 * Flatten a raw reply's date to an ISO string.
 * @param d - An extended-JSON date or an ISO string.
 * @returns The ISO instant string.
 */
export function toIso(d: BsonDate): string {
  return typeof d === "string" ? d : d.$date;
}

/**
 * A half-open window as `$gte`/`$lt` bounds in extended JSON, for a raw
 * command's `$match`.
 * @param range - UTC half-open window.
 * @returns The bounds.
 */
export function dateWindow(range: DateRange): BsonWindow {
  return { $gte: { $date: range.start.toISOString() }, $lt: { $date: range.end.toISOString() } };
}

/**
 * Run an aggregation and return its rows. The rows come back in the cursor's
 * first batch, so `batchSize` is the most rows the call can return: the
 * default makes that the whole result, and a smaller one doubles as a limit.
 * The pipeline goes through untyped, since Prisma types raw commands as JSON.
 * @param collection - The collection to aggregate.
 * @param pipeline - The stages.
 * @param batchSize - The most rows to return.
 * @returns The rows.
 */
export async function aggregateRows<T>(
  collection: string,
  pipeline: readonly object[],
  batchSize = 100_000,
): Promise<T[]> {
  const res = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: collection,
      pipeline,
      cursor: { batchSize },
    }),
  )) as unknown as { cursor: { firstBatch: T[] } };
  return res.cursor.firstBatch;
}
