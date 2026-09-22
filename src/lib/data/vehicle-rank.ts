// src/lib/data/vehicle-rank.ts
// Per-vehicle work over a window, for the hardest-worked vehicles board.
import { cachedForDay, scheduledAtWindow } from "@/lib/data/cache";
import { getRouteModeMap } from "@/lib/data/routes";
import { type ShameFilter, worstStopRouteIds } from "@/lib/data/shame-filter";
import { prisma, runCommand } from "@/lib/db";
import { realDeviationMatchFor } from "@/lib/deviation";
import {
  type DateRange,
  nzServiceDayRange,
  nzServiceDayString,
  serviceDatesInRange,
} from "@/lib/time";
import type { VehicleRunRow } from "@/lib/vehicle-detail";
import { type VehicleDayRow, type VehicleTotal, mergeVehicleDays } from "@/lib/vehicle-rank";

/** A vehicle's row straight from the pipeline, before its mode is looked up. */
type RawVehicleDay = Omit<VehicleDayRow, "m">;

/**
 * One service day's work per vehicle. Two groups: the first folds each run to
 * its first and last recorded arrival, so time in service counts only the time
 * spent on runs and not a midday layover between peaks; the second sums those
 * runs per vehicle. Cached per day, so a week or month merges cached days.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param filter - Mode/school filters, as the boards take them.
 * @param filter.mode - Restrict to this mode; null for every mode.
 * @param filter.includeSchool - Whether school services are included.
 * @param revalidate - TTL for the live day, in seconds.
 * @returns One row per vehicle.
 */
function cachedVehicleWorkOfDay(
  date: string,
  { mode = null, includeSchool = false }: ShameFilter,
  revalidate: number,
): Promise<VehicleDayRow[]> {
  return cachedForDay(
    async (classified) => {
      const routeIds = await worstStopRouteIds(mode, includeSchool);
      // Feed ids are all digits, the same rule as the home page's vehicle counts.
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
              {
                $group: {
                  _id: { v: "$vehicleId", t: "$tripId" },
                  route: { $first: "$routeId" },
                  first: { $min: "$actualAt" },
                  last: { $max: "$actualAt" },
                  e: { $sum: 1 },
                  a: { $sum: { $abs: "$deviationSec" } },
                },
              },
              {
                $group: {
                  _id: "$_id.v",
                  r: { $sum: 1 },
                  ms: { $sum: { $subtract: ["$last", "$first"] } },
                  e: { $sum: "$e" },
                  a: { $sum: "$a" },
                  routes: { $addToSet: "$route" },
                },
              },
              {
                $project: {
                  _id: 0,
                  v: "$_id",
                  r: 1,
                  s: { $round: [{ $divide: ["$ms", 1000] }, 0] },
                  e: 1,
                  a: 1,
                  routes: 1,
                },
              },
            ] as never,
            cursor: { batchSize: 100_000 },
          }),
        ) as unknown as Promise<{ cursor: { firstBatch: RawVehicleDay[] } }>,
        getRouteModeMap(),
      ]);
      const rows: VehicleDayRow[] = [];
      for (const raw of res.cursor.firstBatch) {
        const m = raw.routes.map((id) => modeOf.get(id)).find(Boolean);
        if (m) rows.push({ ...raw, m });
      }
      return rows;
    },
    ["vehicle-work-of-day", date, mode ?? "all", includeSchool ? "school" : "no-school"],
    date,
    revalidate,
  );
}

/**
 * Every vehicle's work over the window, under the mode and school filters,
 * unordered. Days after today are skipped, since they have no arrivals yet.
 * @param range - One service day, a week or a month.
 * @param filter - Mode/school filters.
 * @param revalidate - TTL for the live day, in seconds.
 * @returns One total per vehicle.
 */
export async function getVehicleWork(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<VehicleTotal[]> {
  const days = await getVehicleWorkByDay(range, filter, revalidate);
  return mergeVehicleDays(days.map((d) => d.rows));
}

/**
 * Every vehicle's work, kept apart by service day, for a vehicle page's
 * day-by-day table. Reads the same cached days as {@link getVehicleWork}.
 * @param range - One service day, a week or a month.
 * @param filter - Mode/school filters.
 * @param revalidate - TTL for the live day, in seconds.
 * @returns Each day up to today, oldest first, with its rows.
 */
export async function getVehicleWorkByDay(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<{ date: string; rows: VehicleDayRow[] }[]> {
  const today = nzServiceDayString();
  const days = serviceDatesInRange(range).filter((d) => d <= today);
  const rows = await Promise.all(days.map((d) => cachedVehicleWorkOfDay(d, filter, revalidate)));
  return days.map((date, i) => ({ date, rows: rows[i] ?? [] }));
}

/**
 * One vehicle's runs on one service day, earliest first. Scans the day's
 * arrivals by their scheduled time, as the board does; cached per vehicle and
 * day, so only the first view of a vehicle's day pays for it.
 * @param vehicleId - Feed vehicle id.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param revalidate - TTL for the live day, in seconds.
 * @returns One row per run.
 */
export function getVehicleRunsOfDay(
  vehicleId: string,
  date: string,
  revalidate: number,
): Promise<VehicleRunRow[]> {
  return cachedForDay(
    async (classified) => {
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            {
              $match: {
                scheduledAt: scheduledAtWindow(nzServiceDayRange(date)),
                ...realDeviationMatchFor(classified),
                vehicleId,
              },
            },
            {
              $group: {
                _id: "$tripId",
                routeId: { $first: "$routeId" },
                start: { $min: "$scheduledAt" },
                first: { $min: "$actualAt" },
                last: { $max: "$actualAt" },
                e: { $sum: 1 },
                dev: { $sum: "$deviationSec" },
                abs: { $sum: { $abs: "$deviationSec" } },
                cars: { $max: "$cars" },
              },
            },
            // Epoch ms rather than dates, so the rows cache as plain JSON.
            {
              $project: {
                _id: 0,
                tripId: "$_id",
                routeId: 1,
                startMs: { $toLong: "$start" },
                firstMs: { $toLong: "$first" },
                lastMs: { $toLong: "$last" },
                e: 1,
                dev: 1,
                abs: 1,
                cars: { $ifNull: ["$cars", null] },
              },
            },
            { $sort: { startMs: 1 } },
          ] as never,
          cursor: { batchSize: 1_000 },
        }),
      )) as unknown as { cursor: { firstBatch: VehicleRunRow[] } };
      // A $toLong result can come back as extended JSON on some drivers.
      return res.cursor.firstBatch.map((r) => ({
        ...r,
        startMs: Number(r.startMs),
        firstMs: Number(r.firstMs),
        lastMs: Number(r.lastMs),
      }));
    },
    ["vehicle-runs-of-day", vehicleId, date],
    date,
    revalidate,
  );
}
