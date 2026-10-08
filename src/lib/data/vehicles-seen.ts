// src/lib/data/vehicles-seen.ts
// How many distinct buses, trains and ferries ran the ranked routes, over a
// window and since the archive began: the vehicle sets the nightly rollup stored
// for each past day, plus a live scan of every day that has started but carries none.
import { DAY_MARKER } from "@/lib/cron/trip-punctuality";
import { dayVehiclesMatch, hourRangeMask } from "@/lib/cron/vehicle-sets";
import { cachedForDay, cacheKey, scheduledAtWindow } from "@/lib/data/cache";
import { aggregateRows, type BsonDate, dateWindow, toIso } from "@/lib/data/raw";
import {
  COMPLETED_DAY_REVALIDATE,
  DAY_REVALIDATE,
  FIVE_MINUTE_REVALIDATE,
} from "@/lib/data/revalidate";
import { getRouteModeMap } from "@/lib/data/routes";
import { promoteScan, type ScanPriority, withScanSlot } from "@/lib/data/scan-gate";
import { type ShameFilter, worstStopRouteIds } from "@/lib/data/shame-filter";
import { memCache, sharedInFlight, unstable_cache } from "@/lib/mem-cache";
import type { Mode } from "@/lib/mode";
import { DATA_START_DAY } from "@/lib/time/data-start";
import {
  type DateRange,
  NZ_TZ,
  nzServiceDayRange,
  nzServiceDayString,
  serviceDatesInRange,
  shiftDays,
} from "@/lib/time/service-day";
import { type HourRange, hourRangeParam, hoursInRange } from "@/lib/time/time-of-day";
import {
  countVehicles,
  mergeVehicles,
  type VehicleCounts,
  type VehicleRouteRow,
  type VehiclesByMode,
  vehiclesByMode,
} from "@/lib/vehicle/counts";
import { createHash } from "node:crypto";

/** The stored part of a window's vehicles; plain data so the Data Cache can hold it. */
interface StoredVehicles {
  /** Distinct vehicle ids per mode over the stored days (a vehicle may appear under two modes). */
  byMode: VehiclesByMode;
  /** Service dates (`YYYY-MM-DD`) with a complete stored set. */
  dates: string[];
}

/**
 * No vehicles, for a part with no days to read.
 * @returns An empty set per mode.
 */
function noVehicles(): VehiclesByMode {
  return { BUS: [], TRAIN: [], FERRY: [] };
}

/**
 * The key parts naming one filter: mode, school rule and, only when set, the hours, so the
 * whole-day entries keep their keys.
 * @param filter - Mode/school filters.
 * @param filter.mode - Restrict to this mode; null for every mode.
 * @param filter.schools - Which school services count.
 * @param hours - Part of the day, or null for all of it.
 * @returns The key parts.
 */
function filterKey(
  { mode = null, schools = "exclude" }: ShameFilter,
  hours: HourRange | null,
): string[] {
  return [mode ?? "all", schools, ...(hours ? [hourRangeParam(hours) ?? ""] : [])];
}

/**
 * Start the two lookups a vehicle read filters and splits by: the routes the filter keeps
 * (null for all) and each route's mode. Called outside the cached read that uses them, since
 * a nested `unstable_cache` call skips its read, and caught so a failure is handled until
 * the read awaits it.
 * @param filter - Mode/school filters.
 * @returns The route ids and the mode map, once both land.
 */
function startLookups(filter: ShameFilter): Promise<[string[] | null, Map<string, Mode>]> {
  const lookups = Promise.all([
    worstStopRouteIds(filter.mode ?? null, filter.schools ?? "exclude"),
    getRouteModeMap(),
  ]);
  lookups.catch(() => undefined);
  return lookups;
}

/**
 * The aggregation that unions the stored vehicle sets of the given days. Each vehicle keeps
 * one route per day, the lowest id, as the live scan keeps the first: a vehicle on two
 * modes' routes in one day counts under one of them, while a vehicle seen on several days
 * keeps each day's route, so it counts under every mode it ran on some day.
 * @param dates - The marked days' stored start instants.
 * @param routeIds - The routes the filter keeps, or null for all.
 * @param hours - Count only vehicles due in this part of the day, or null for all of it.
 * @returns The pipeline stages, ending in one `{ v, r }` row per vehicle and route.
 */
export function storedVehiclesPipeline(
  dates: readonly { $date: string }[],
  routeIds: readonly string[] | null,
  hours: HourRange | null,
): object[] {
  return [
    {
      $match: {
        date: { $in: [...dates] },
        routeId: routeIds ? { $in: [...routeIds] } : { $ne: DAY_MARKER },
      },
    },
    { $unwind: "$vs" },
    ...(hours ? [{ $match: { "vs.h": { $bitsAnySet: hourRangeMask(hours) } } }] : []),
    { $group: { _id: { d: "$date", v: "$vs.v" }, r: { $min: "$routeId" } } },
    { $group: { _id: { v: "$_id.v", r: "$r" } } },
    { $project: { _id: 0, v: "$_id.v", r: "$_id.r" } },
  ];
}

/**
 * The days in a window whose vehicle sets are complete, as their stored start instants
 * (ISO), oldest first. Only days carrying the {@link DAY_MARKER} row count: the writer adds it
 * after every route's row has landed, so a day whose write failed part way is scanned live
 * instead of read half full. One small indexed read, cached for five minutes so a night's
 * write reaches the counts within that.
 * @param range - UTC half-open window, already clipped to end before today.
 * @returns The marked days' start instants.
 */
function markedDays(range: DateRange): Promise<string[]> {
  return unstable_cache(
    async () => {
      const marks = await aggregateRows<{ date: BsonDate }>("DailyVehicleSet", [
        { $match: { routeId: DAY_MARKER, date: dateWindow(range) } },
        { $sort: { date: 1 } },
        { $project: { _id: 0, date: 1 } },
      ]);
      return marks.map((m) => toIso(m.date));
    },
    ["vehicle-set-marks", range.start.toISOString(), range.end.toISOString()],
    { revalidate: FIVE_MINUTE_REVALIDATE },
  )();
}

/**
 * The stored vehicles over a window's marked days, cached under the set of days it read. A
 * stored day never changes short of a backfill re-run, which follows a change to the ghost
 * pass and so a new cache version, so the entry holds for a week, and a newly marked day is
 * a new key rather than a wait on a TTL. The window stops at the start of today, which is
 * never stored, so a window of today alone reads nothing. Called outside any other
 * `unstable_cache` callback, as every vehicle read is.
 * @param range - UTC half-open window.
 * @param todayStart - Start of the current service day.
 * @param filter - Mode/school filters.
 * @param hours - Part of the day, or null for all of it.
 * @returns The stored vehicles per mode and the stored service dates.
 */
async function cachedStoredVehicles(
  range: DateRange,
  todayStart: Date,
  filter: ShameFilter,
  hours: HourRange | null,
): Promise<StoredVehicles> {
  const end = new Date(Math.min(range.end.getTime(), todayStart.getTime()));
  if (end <= range.start) return { byMode: noVehicles(), dates: [] };
  const lookups = startLookups(filter);
  const days = await markedDays({ start: range.start, end });
  if (days.length === 0) return { byMode: noVehicles(), dates: [] };
  // A hash of every day, not just the ends and the count: a re-run of a stored day lifts
  // its marker for a moment, so a set can lose a day from the middle, and two such sets
  // must not share an entry.
  const daysHash = createHash("sha1").update(days.join(",")).digest("base64url");
  const byMode = await unstable_cache(
    async () => {
      const [routeIds, modeOf] = await lookups;
      const rows = await aggregateRows<VehicleRouteRow>(
        "DailyVehicleSet",
        storedVehiclesPipeline(
          days.map(($date) => ({ $date })),
          routeIds,
          hours,
        ),
      );
      // One row per vehicle and route across the days, so a vehicle on several routes repeats.
      return mergeVehicles([vehiclesByMode(rows, modeOf)]);
    },
    cacheKey(["vehicles-stored", daysHash, ...filterKey(filter, hours)], "final"),
    { revalidate: COMPLETED_DAY_REVALIDATE },
  )();
  return { byMode, dates: days.map((d) => nzServiceDayString(new Date(d))) };
}

/**
 * One unstored service day's distinct vehicles per mode, scanned from the raw arrivals and
 * cached per day. Ids are kept, not counts, because the same bus runs on most days of a week.
 * Must be called outside any other `unstable_cache` callback: a nested call skips its
 * cache read, so the day would be scanned again. A running read is shared between the window
 * card and the all-time card, which ask for the same days at once; on a cold cache each would
 * otherwise scan the day. The scan itself waits for a slot (see {@link withScanSlot}), so a
 * cold all-time read cannot hold every pooled connection; a front read moves a day the
 * all-time read queued first up with it ({@link promoteScan}).
 * @param date - Service date (`YYYY-MM-DD`).
 * @param filter - Mode/school filters, as the boards take them.
 * @param revalidate - TTL for the live day, in seconds.
 * @param hours - Count only vehicles on runs due in this part of the day, or null for all of it.
 * @param priority - The scan's queue when every slot is busy: front for the shown window.
 * @returns The day's vehicle ids per mode.
 */
function cachedVehiclesOfDay(
  date: string,
  filter: ShameFilter,
  revalidate: number,
  hours: HourRange | null,
  priority: ScanPriority,
): Promise<VehiclesByMode> {
  const key = ["vehicles-of-day", date, ...filterKey(filter, hours)];
  const flatKey = key.join(":");
  // A history read may already have queued this day's scan at the back.
  if (priority === "front") promoteScan(flatKey);
  return sharedInFlight(flatKey, () => {
    // Started outside the cached callback, so a failed lookup rejects the read before its
    // scan joins the queue rather than leaving the scan queued with no one to read it.
    const lookups = startLookups(filter);
    return cachedForDay(
      async (classified) => {
        const [routeIds, modeOf] = await lookups;
        const match = dayVehiclesMatch(scheduledAtWindow(nzServiceDayRange(date)), classified);
        if (routeIds) match.routeId = { $in: routeIds };
        // As on the route page's hours: an $expr sees only the rows the scheduledAt
        // bounds let through, so it adds a comparison per row and no scan.
        if (hours) {
          match.$expr = {
            $in: [{ $hour: { date: "$scheduledAt", timezone: NZ_TZ } }, hoursInRange(hours)],
          };
        }
        const res = await withScanSlot(flatKey, priority, () =>
          aggregateRows<VehicleRouteRow>("ArrivalEvent", [
            { $match: match },
            { $group: { _id: "$vehicleId", r: { $first: "$routeId" } } },
            { $project: { _id: 0, v: "$_id", r: 1 } },
          ]),
        );
        return vehiclesByMode(res, modeOf);
      },
      key,
      date,
      revalidate,
    );
  });
}

/**
 * Distinct buses, trains and ferries that ran the routes the rankings cover,
 * under the same mode and school filters. Trains are counted by the unit that
 * carried each run: AT's feed puts the trip on one unit of a coupled set.
 * Stored days come from the vehicle sets in one cached read; today, and any
 * earlier day the rollup has not stored, is scanned through its own day entry.
 * Today's scan starts beside the stored read, since today is never stored.
 * @param range - The window: one service day, a week or a month.
 * @param filter - Mode/school filters.
 * @param revalidate - TTL for the live day, in seconds.
 * @param hours - Part of the day to count, or null for all of it.
 * @returns Distinct vehicles per mode.
 */
export async function getVehicleCounts(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
  hours: HourRange | null = null,
): Promise<VehicleCounts> {
  // One clock read, so a request that crosses 4am cannot read the closing day twice.
  const now = new Date();
  const today = nzServiceDayString(now);
  // Days after today have no arrivals yet.
  const days = serviceDatesInRange(range).filter((d) => d <= today);
  const [stored, todayPart] = await Promise.all([
    cachedStoredVehicles(range, nzServiceDayRange(today).start, filter, hours),
    days.includes(today)
      ? cachedVehiclesOfDay(today, filter, revalidate, hours, "front")
      : Promise.resolve(noVehicles()),
  ]);
  const storedDays = new Set(stored.dates);
  const unstored = days.filter((d) => d !== today && !storedDays.has(d));
  return countVehicles([
    stored.byMode,
    todayPart,
    ...(await Promise.all(
      unstored.map((d) => cachedVehiclesOfDay(d, filter, revalidate, hours, "front")),
    )),
  ]);
}

/**
 * Distinct vehicles per mode since the archive began, as far back as the stored
 * vehicle sets (pruned with the daily summaries) or ArrivalEvent retention reach.
 * Every day before today is read from the stored
 * sets where the rollup has stored it, and scanned through its own day entry
 * where it has not; that union is held once per process under today's date, so a
 * render reads it plus today's own day. Unstored days queue behind the shown
 * window's scans and go newest first, so on a cold cache the days a week or month
 * view shares fill soonest.
 * @param filter - Mode/school filters.
 * @param revalidate - TTL for today, in seconds.
 * @param hours - Part of the day to count on every day, or null for all of it.
 * @returns Distinct vehicles per mode.
 */
export async function getVehicleCountsAllTime(
  filter: ShameFilter,
  revalidate: number,
  hours: HourRange | null = null,
): Promise<VehicleCounts> {
  const now = new Date();
  const today = nzServiceDayString(now);
  const todayStart = nzServiceDayRange(today).start;
  const before = memCache(
    ["vehicles-before", today, ...filterKey(filter, hours)].join(":"),
    DAY_REVALIDATE,
    async () => {
      const history = { start: nzServiceDayRange(DATA_START_DAY).start, end: todayStart };
      const stored = await cachedStoredVehicles(history, todayStart, filter, hours);
      const storedDays = new Set(stored.dates);
      const unstored: string[] = [];
      for (let d = shiftDays(today, -1); d >= DATA_START_DAY; d = shiftDays(d, -1)) {
        if (!storedDays.has(d)) unstored.push(d);
      }
      return mergeVehicles([
        stored.byMode,
        ...(await Promise.all(
          unstored.map((d) => cachedVehiclesOfDay(d, filter, revalidate, hours, "back")),
        )),
      ]);
    },
  );
  const [past, current] = await Promise.all([
    before,
    cachedVehiclesOfDay(today, filter, revalidate, hours, "front"),
  ]);
  return countVehicles([past, current]);
}
