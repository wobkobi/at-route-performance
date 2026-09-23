// src/lib/data/data-days.ts
// The edges of the archive: the earliest and latest days with enough data to show.
import { DATA_START_DAY } from "@/lib/data-start";
import { prisma, runCommand } from "@/lib/db";
import { unstable_cache } from "@/lib/mem-cache";
import { nzServiceDayRange, nzServiceDayString, serviceDayNoon, shiftWeek } from "@/lib/time";

/**
 * The scheduled time of the event at one end of the collection, read via the
 * `scheduledAt` index (sort + limit 1) so it stays cheap as the collection
 * grows. The `$group`/`$max` alternative scans every document - at 3M+ events
 * that is a 15s+ query on the shared cluster.
 * @param direction - 1 for the earliest event, -1 for the latest.
 * @returns That event's `scheduledAt`, or null when the collection is empty.
 */
async function endpointEventTime(direction: 1 | -1): Promise<Date | null> {
  const res = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: [
        { $sort: { scheduledAt: direction } },
        { $limit: 1 },
        { $project: { _id: 0, scheduledAt: 1 } },
      ] as never,
      cursor: {},
    }),
  )) as unknown as { cursor: { firstBatch: { scheduledAt?: { $date: string } | string }[] } };
  const raw = res.cursor.firstBatch[0]?.scheduledAt;
  if (!raw) return null;
  return new Date(typeof raw === "string" ? raw : raw.$date);
}

/**
 * How many service days {@link findQualifyingDataDay} walks inward from the
 * collection's edge before giving up. Independent of the retention window: 21
 * consecutive sub-threshold days at an edge means the qualifying threshold is
 * effectively never met, and each step costs an indexed count.
 */
const DATA_DAY_WALK_LIMIT = 21;

/**
 * The service day nearest one end of the collection with at least `minEvents`
 * events, never earlier than the archive floor: the forward walk starts at the
 * later of the end event's day and {@link DATA_START_DAY}, and the backward walk
 * gives up at the floor rather than burning all 21 steps on days that cannot
 * exist. The indexed probe stays rather than collapsing `minEvents <= 1` to the
 * constant: that shortcut is free for ten years and then pins the stepper at
 * 2026-09-11 while the cleanup deletes 2026-09-11, 09-12, 09-13 in turn.
 * @param direction - 1 to search from the earliest event forward, -1 from the latest back.
 * @param minEvents - Minimum events a service day needs to qualify.
 * @returns The qualifying service date (`YYYY-MM-DD`), or null when none is found.
 */
async function findQualifyingDataDay(direction: 1 | -1, minEvents: number): Promise<string | null> {
  const endpoint = await endpointEventTime(direction);
  if (!endpoint) return null;
  let day = nzServiceDayString(endpoint);
  if (day < DATA_START_DAY) day = DATA_START_DAY;
  for (let i = 0; i < DATA_DAY_WALK_LIMIT; i++) {
    if (day < DATA_START_DAY) return null;
    if (i === 0 && minEvents <= 1) return day;
    const range = nzServiceDayRange(day);
    const n = await prisma.arrivalEvent.count({
      where: { scheduledAt: { gte: range.start, lt: range.end } },
    });
    if (n >= minEvents) return day;
    // Step inward: forward from the earliest end, back from the latest.
    day = shiftWeek(day, direction);
  }
  return null;
}

/**
 * The most recent event's scheduled time, for empty-window fallback.
 * @returns The max `scheduledAt`, or null when there are no events.
 */
export async function getLatestEventDate(): Promise<Date | null> {
  // Indexed endpoint lookup; still cached because the latest event only
  // advances once per ingest cycle and this sits on the home page's
  // critical path.
  const iso = await unstable_cache(
    async () => (await endpointEventTime(-1))?.toISOString() ?? null,
    ["latest-event-date"],
    { revalidate: 600 },
  )();
  return iso ? new Date(iso) : null;
}

/**
 * The most recent Auckland-local **service day** that has at least `minEvents`
 * events. Day-focused pages fall back to this when the current service day is
 * sparse. Service-day bucketing matches `nzServiceDayString`, so a post-midnight
 * run counts under the day it started.
 * @param minEvents - Minimum events a service day needs to qualify.
 * @returns A Date inside that service day (its local noon), or null when empty.
 */
export async function getMostRecentDataDay(minEvents: number): Promise<Date | null> {
  const day = await unstable_cache(
    () => findQualifyingDataDay(-1, minEvents),
    ["most-recent-data-day", String(minEvents)],
    { revalidate: 600 },
  )();
  return day ? serviceDayNoon(day) : null;
}

/**
 * Arrivals due so far that open the current service day on a page given no
 * `?day`. On 22 Sep 2026 the network passed 2,000 at about 5:45am, the quarter
 * hour in which the first routes reached the home page's per-route board
 * minimum; a page opening on the new day before then shows a near-empty day.
 */
export const DAY_OPEN_EVENTS = 2000;

/**
 * Whether the current service day has enough arrivals due to open on it. Counts
 * only up to now, since the ingest stores predictions for stops not yet due, and
 * stops at {@link DAY_OPEN_EVENTS} so the count costs the same at 11pm as at
 * 5am. One cached answer per `revalidate`, so every page asking inside it opens
 * on the same day.
 * @param revalidate - Cache lifetime in seconds.
 * @returns True once the day has opened.
 */
export async function currentDayIsOpen(revalidate: number): Promise<boolean> {
  const today = nzServiceDayString();
  return unstable_cache(
    async () => {
      const { start } = nzServiceDayRange(today);
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          count: "ArrivalEvent",
          query: {
            scheduledAt: {
              $gte: { $date: start.toISOString() },
              $lt: { $date: new Date().toISOString() },
            },
          },
          limit: DAY_OPEN_EVENTS,
        }),
      )) as unknown as { n: number };
      return res.n >= DAY_OPEN_EVENTS;
    },
    ["day-open", today],
    { revalidate },
  )();
}

/**
 * The earliest Auckland-local **service day** that has at least `minEvents`
 * events. Day-focused pages use this to stop the day stepper paging back past
 * where data exists. Buckets match {@link getMostRecentDataDay}, so the
 * boundary is symmetric.
 * @param minEvents - Minimum events a service day needs to qualify.
 * @returns A Date inside that service day (its local noon), or null when empty.
 */
export async function getEarliestDataDay(minEvents: number): Promise<Date | null> {
  const day = await unstable_cache(
    () => findQualifyingDataDay(1, minEvents),
    ["earliest-data-day", String(minEvents)],
    // Moves when the nightly cleanup prunes the oldest day; ten minutes, like
    // the latest/most-recent markers, so the day stepper cannot offer a day
    // that was just deleted for hours.
    { revalidate: 600 },
  )();
  return day ? serviceDayNoon(day) : null;
}
