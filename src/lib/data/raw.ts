// Helpers for Prisma's raw Mongo commands: running an aggregation, and the
// extended-JSON dates the commands take and return. A leaf module (only the
// client and the time types), so the cron passes can use it without importing
// the cache policy and, through it, the ingest loop that imports them.
import { prisma, runCommand } from "@/lib/db";
import { timedRead } from "@/lib/read-timing";
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
  const res = (await timedRead(`aggregate ${collection} ${matchedFields(pipeline)}`, () =>
    runCommand(() =>
      prisma.$runCommandRaw({
        aggregate: collection,
        pipeline,
        cursor: { batchSize },
      }),
    ),
  )) as unknown as { cursor: { firstBatch: T[] } };
  return res.cursor.firstBatch;
}

/**
 * Run a `find` and return its documents, for a lookup by a long list of ids. Prisma's
 * own `in` filter reaches MongoDB as an `$or` of one `$eq` per value inside `$expr`,
 * which costs about the square of the list: 7,066 stop ids took 5.6s that way and
 * 84ms as the plain `$in` sent here. Documents come back as stored: `_id` rather than
 * `id`, and dates in extended JSON (see {@link toIso}).
 * @param collection - The collection to read.
 * @param filter - The query filter.
 * @param projection - The fields to return.
 * @param batchSize - The most documents to return.
 * @returns The documents.
 */
export async function findRows<T>(
  collection: string,
  filter: Record<string, unknown>,
  projection: Record<string, 0 | 1>,
  batchSize = 100_000,
): Promise<T[]> {
  const res = (await timedRead(`find ${collection} ${Object.keys(filter).join(",")}`, () =>
    runCommand(() =>
      prisma.$runCommandRaw({
        find: collection,
        filter: filter as never,
        projection,
        batchSize,
      }),
    ),
  )) as unknown as { cursor: { firstBatch: T[] } };
  return res.cursor.firstBatch;
}

/**
 * The fields a pipeline's leading `$match` filters on, to tell one aggregation from
 * another in a timing line without printing the whole pipeline.
 * @param pipeline - The stages.
 * @returns The field names joined by commas, or "-" without a leading `$match`.
 */
function matchedFields(pipeline: readonly object[]): string {
  const first = pipeline[0] as { $match?: object } | undefined;
  return first?.$match ? Object.keys(first.$match).join(",") : "-";
}
