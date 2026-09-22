// src/lib/data/vehicles-seen.ts
// How many distinct buses, trains and ferries ran the ranked routes, over a
// window and since the archive began.
import { DATA_START_DAY } from "@/lib/data-start";
import { cachedForDay, scheduledAtWindow } from "@/lib/data/cache";
import { getRouteModeMap } from "@/lib/data/routes";
import { type ShameFilter, worstStopRouteIds } from "@/lib/data/shame-filter";
import { prisma, runCommand } from "@/lib/db";
import { realDeviationMatchFor } from "@/lib/deviation";
import { unstable_cache } from "@/lib/mem-cache";
import {
  type DateRange,
  nzServiceDayRange,
  nzServiceDayString,
  serviceDatesInRange,
  shiftWeek,
} from "@/lib/time";
import {
  type VehicleCounts,
  type VehicleRouteRow,
  type VehiclesByMode,
  countVehicles,
  mergeVehicles,
  vehiclesByMode,
} from "@/lib/vehicle-counts";

/** A completed day's union only changes when a new day completes. */
const COMPLETED_DAYS_REVALIDATE = 86_400;

/**
 * One service day's distinct vehicles per mode, cached per day so a week, a
 * month or the whole archive is a union of cached days rather than one scan.
 * Ids are kept, not counts, because the same bus runs on most days of a week.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param filter - Mode/school filters, as the boards take them.
 * @param filter.mode - Restrict to this mode; null for every mode.
 * @param filter.includeSchool - Whether school services are included.
 * @param revalidate - TTL for the live day, in seconds.
 * @returns The day's vehicle ids per mode.
 */
function cachedVehiclesOfDay(
  date: string,
  { mode = null, includeSchool = false }: ShameFilter,
  revalidate: number,
): Promise<VehiclesByMode> {
  return cachedForDay(
    async (classified) => {
      const routeIds = await worstStopRouteIds(mode, includeSchool);
      // Feed ids are all digits; the few rows holding a fleet label or nothing
      // at all would count one vehicle twice or count a blank.
      const match: Record<string, unknown> = {
        scheduledAt: scheduledAtWindow(nzServiceDayRange(date)),
        ...realDeviationMatchFor(classified),
        vehicleId: { $regex: "^[0-9]+$" },
      };
      if (routeIds) match.routeId = { $in: routeIds };
      const [res, modeOf] = await Promise.all([
        runCommand(() =>
          prisma.$runCommandRaw({
            aggregate: "ArrivalEvent",
            pipeline: [
              { $match: match },
              { $group: { _id: "$vehicleId", r: { $first: "$routeId" } } },
              { $project: { _id: 0, v: "$_id", r: 1 } },
            ] as never,
            cursor: { batchSize: 100_000 },
          }),
        ) as unknown as Promise<{ cursor: { firstBatch: VehicleRouteRow[] } }>,
        getRouteModeMap(),
      ]);
      return vehiclesByMode(res.cursor.firstBatch, modeOf);
    },
    ["vehicles-of-day", date, mode ?? "all", includeSchool ? "school" : "no-school"],
    date,
    revalidate,
  );
}

/**
 * Distinct buses, trains and ferries that ran the routes the rankings cover,
 * under the same mode and school filters. Trains are counted by the unit that
 * carried each run: AT's feed puts the trip on one unit of a coupled set.
 * @param range - The window: one service day, a week or a month.
 * @param filter - Mode/school filters.
 * @param revalidate - TTL for the live day, in seconds.
 * @returns Distinct vehicles per mode.
 */
export async function getVehicleCounts(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<VehicleCounts> {
  const today = nzServiceDayString();
  // Days after today have no arrivals yet.
  const days = serviceDatesInRange(range).filter((d) => d <= today);
  return countVehicles(
    await Promise.all(days.map((d) => cachedVehiclesOfDay(d, filter, revalidate))),
  );
}

/**
 * Distinct vehicles per mode since the archive began (or as far back as
 * ArrivalEvent retention keeps). Every day before today is unioned once and
 * cached under today's date, so a render reads that union plus today's own
 * day instead of one cached entry per day on record.
 * @param filter - Mode/school filters.
 * @param revalidate - TTL for today, in seconds.
 * @returns Distinct vehicles per mode.
 */
export async function getVehicleCountsAllTime(
  filter: ShameFilter,
  revalidate: number,
): Promise<VehicleCounts> {
  const today = nzServiceDayString();
  const { mode = null, includeSchool = false } = filter;
  const before = unstable_cache(
    async () => {
      const days: string[] = [];
      for (let d = DATA_START_DAY; d < today; d = shiftWeek(d, 1)) days.push(d);
      return mergeVehicles(
        await Promise.all(days.map((d) => cachedVehiclesOfDay(d, filter, revalidate))),
      );
    },
    ["vehicles-before", today, mode ?? "all", includeSchool ? "school" : "no-school"],
    { revalidate: COMPLETED_DAYS_REVALIDATE },
  )();
  const [past, current] = await Promise.all([
    before,
    cachedVehiclesOfDay(today, filter, revalidate),
  ]);
  return countVehicles([past, current]);
}
