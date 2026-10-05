// src/lib/data/vehicles-seen.ts
// How many distinct buses, trains and ferries ran the ranked routes, over a
// window and since the archive began.
import { cachedForDay, scheduledAtWindow } from "@/lib/data/cache";
import { aggregateRows } from "@/lib/data/raw";
import { DAY_REVALIDATE } from "@/lib/data/revalidate";
import { getRouteModeMap } from "@/lib/data/routes";
import { promoteScan, type ScanPriority, withScanSlot } from "@/lib/data/scan-gate";
import { type ShameFilter, worstStopRouteIds } from "@/lib/data/shame-filter";
import { realDeviationMatchFor } from "@/lib/deviation";
import { memCache, sharedInFlight } from "@/lib/mem-cache";
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
 * One service day's distinct vehicles per mode, cached per day so a week, a
 * month or the whole archive is a union of cached days rather than one scan.
 * Ids are kept, not counts, because the same bus runs on most days of a week.
 * Must be called outside any other `unstable_cache` callback: a nested call skips its
 * cache read, so every finished day would be scanned again. A running read is shared
 * between the window card and the all-time card, which ask for the same days at once;
 * on a cold cache each would otherwise scan the day. The scan itself waits for a slot
 * (see {@link withScanSlot}), so a cold all-time read cannot hold every pooled connection;
 * a front read moves a day the all-time read queued first up with it ({@link promoteScan}).
 * @param date - Service date (`YYYY-MM-DD`).
 * @param filter - Mode/school filters, as the boards take them.
 * @param filter.mode - Restrict to this mode; null for every mode.
 * @param filter.schools - Which school services count (default leave them out).
 * @param revalidate - TTL for the live day, in seconds.
 * @param hours - Count only vehicles on runs due in this part of the day, or null for all of it.
 * @param priority - The scan's queue when every slot is busy: front for the shown window.
 * @returns The day's vehicle ids per mode.
 */
function cachedVehiclesOfDay(
  date: string,
  { mode = null, schools = "exclude" }: ShameFilter,
  revalidate: number,
  hours: HourRange | null,
  priority: ScanPriority,
): Promise<VehiclesByMode> {
  const key = ["vehicles-of-day", date, ...filterKey({ mode, schools }, hours)];
  const flatKey = key.join(":");
  // A history read may already have queued this day's scan at the back.
  if (priority === "front") promoteScan(flatKey);
  return sharedInFlight(flatKey, () => {
    // Started outside the cached callback, so a failed lookup rejects the read
    // before its scan joins the queue rather than leaving the scan queued with no
    // one to read it. The catch only marks the promise handled until it is awaited.
    const lookups = Promise.all([worstStopRouteIds(mode, schools), getRouteModeMap()]);
    lookups.catch(() => undefined);
    return cachedForDay(
      async (classified) => {
        const [routeIds, modeOf] = await lookups;
        // Feed ids are all digits; the few rows holding a fleet label or nothing
        // at all would count one vehicle twice or count a blank.
        const match: Record<string, unknown> = {
          scheduledAt: scheduledAtWindow(nzServiceDayRange(date)),
          ...realDeviationMatchFor(classified),
          vehicleId: { $regex: "^[0-9]+$" },
        };
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
  const today = nzServiceDayString();
  // Days after today have no arrivals yet.
  const days = serviceDatesInRange(range).filter((d) => d <= today);
  return countVehicles(
    await Promise.all(days.map((d) => cachedVehiclesOfDay(d, filter, revalidate, hours, "front"))),
  );
}

/**
 * Distinct vehicles per mode since the archive began (or as far back as
 * ArrivalEvent retention keeps). Every day before today is read through its own
 * day entry and unioned once per process under today's date, so a render reads
 * that union plus today's own day. The union is held in memory rather than the
 * Data Cache, since a Data Cache entry around the day reads would skip their
 * cached values and scan every day on record each time it missed. Earlier days queue
 * behind the shown window's scans and go newest first, so on a cold cache the days a
 * week or month view shares fill soonest.
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
  const today = nzServiceDayString();
  const before = memCache(
    ["vehicles-before", today, ...filterKey(filter, hours)].join(":"),
    DAY_REVALIDATE,
    async () => {
      const days: string[] = [];
      for (let d = shiftDays(today, -1); d >= DATA_START_DAY; d = shiftDays(d, -1)) days.push(d);
      return mergeVehicles(
        await Promise.all(
          days.map((d) => cachedVehiclesOfDay(d, filter, revalidate, hours, "back")),
        ),
      );
    },
  );
  const [past, current] = await Promise.all([
    before,
    cachedVehiclesOfDay(today, filter, revalidate, hours, "front"),
  ]);
  return countVehicles([past, current]);
}
