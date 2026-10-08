// src/lib/cron/vehicle-sets.ts
// Nightly per-route sets of the vehicles that ran one completed service day, with the
// Auckland clock hours each was due, stored one row per route in DailyVehicleSet so the
// home page's vehicle counts union stored days rather than scan every day's arrivals.
import { DAY_MARKER } from "@/lib/cron/trip-punctuality";
import { aggregateRows, dateWindow, type BsonWindow } from "@/lib/data/raw";
import { prisma, runCommand, throwOnWriteErrors } from "@/lib/db";
import { realDeviationMatchFor } from "@/lib/deviation";
import { NZ_TZ, nzServiceDayRange } from "@/lib/time/service-day";
import { hoursInRange, type HourRange } from "@/lib/time/time-of-day";
import type { Prisma } from "@prisma/client";

/** One vehicle seen on a route in a day, as stored. */
export interface VehicleSeen {
  /** Vehicle id. */
  v: string;
  /** Bit n set when the vehicle was due at a stop in Auckland clock hour n (see {@link hourMask}). */
  h: number;
}

/** One route's vehicles as {@link vehicleSetsPipeline} returns them. */
interface VehicleSetRow {
  /** Route id. */
  _id: string;
  vs: { v: string; hs: number[] }[];
}

/**
 * The `$match` fields every per-day vehicle read shares. Feed ids are all digits; the few
 * rows holding a fleet label or nothing at all would count one vehicle twice or count a blank.
 * @param window - The `scheduledAt` bounds.
 * @param classified - Whether the day has been through the ghost pass (see
 *   {@link realDeviationMatchFor}).
 * @returns The match fields.
 */
export function dayVehiclesMatch(window: BsonWindow, classified: boolean): Record<string, unknown> {
  return {
    scheduledAt: window,
    ...realDeviationMatchFor(classified),
    vehicleId: { $regex: "^[0-9]+$" },
  };
}

/**
 * Pack clock hours into one number, bit n for hour n, so a stored row answers "was this
 * vehicle due in any of these hours" with one `$bitsAnySet`. 24 bits fit an int32.
 * @param hours - Auckland clock hours, 0-23.
 * @returns The mask.
 */
export function hourMask(hours: readonly number[]): number {
  let mask = 0;
  for (const h of hours) mask |= 1 << h;
  return mask;
}

/**
 * {@link hourMask} of every hour in a part of the day, wrapping past midnight as
 * {@link hoursInRange} does.
 * @param range - The part of the day.
 * @returns The mask.
 */
export function hourRangeMask(range: HourRange): number {
  return hourMask(hoursInRange(range));
}

/**
 * The aggregation that gathers one completed day's distinct vehicles per route, each with
 * the clock hours it was due at a stop. The bounds and filters are the live count's (see
 * {@link dayVehiclesMatch}), classified, since the nightly rollup runs after the ghost pass,
 * and the hour is `scheduledAt`'s Auckland hour, the one a live count narrows by. A vehicle on
 * two routes gets a row under each, so any route filter can be applied when reading.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns The pipeline stages.
 */
export function vehicleSetsPipeline(date: string): object[] {
  return [
    { $match: dayVehiclesMatch(dateWindow(nzServiceDayRange(date)), true) },
    {
      $group: {
        _id: { r: "$routeId", v: "$vehicleId" },
        hs: { $addToSet: { $hour: { date: "$scheduledAt", timezone: NZ_TZ } } },
      },
    },
    { $group: { _id: "$_id.r", vs: { $push: { v: "$_id.v", hs: "$hs" } } } },
  ];
}

/**
 * Read one completed day's vehicles per route, without writing. The backfill's dry run
 * prints this.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns Route id to its vehicles.
 */
export async function vehicleSetsOfDay(date: string): Promise<Map<string, VehicleSeen[]>> {
  const rows = await aggregateRows<VehicleSetRow>("ArrivalEvent", vehicleSetsPipeline(date));
  return new Map(rows.map((r) => [r._id, r.vs.map(({ v, hs }) => ({ v, h: hourMask(hs) }))]));
}

/**
 * The indexes DailyVehicleSet needs, created by the writer itself so the collection works
 * before a schema push. The names are the ones Prisma gives the model's `@@unique` and
 * `@@index`, so a later `db push` finds them in place rather than failing on a second index
 * over the same keys.
 */
export const VEHICLE_SET_INDEXES: Prisma.InputJsonObject = {
  createIndexes: "DailyVehicleSet",
  indexes: [
    { key: { routeId: 1, date: 1 }, name: "DailyVehicleSet_routeId_date_key", unique: true },
    { key: { date: 1 }, name: "DailyVehicleSet_date_idx" },
  ],
};

/**
 * The bulk-upsert entries that store each route's vehicles for one day, keyed on the route
 * and the exact service-day start, so a re-run replaces a route's row rather than adding to it.
 * @param sets - Route id to its vehicles.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns The update entries.
 */
export function vehicleSetUpsertOps(
  sets: ReadonlyMap<string, readonly VehicleSeen[]>,
  date: string,
): Prisma.InputJsonObject[] {
  const dateBson = { $date: nzServiceDayRange(date).start.toISOString() };
  return [...sets].map(([routeId, vs]) => ({
    q: { routeId, date: dateBson },
    u: { $set: { routeId, date: dateBson, vs: vs.map(({ v, h }) => ({ v, h })) } },
    upsert: true,
  }));
}

/**
 * The delete entry that clears a day's rows for routes this run did not see, so a re-run that
 * finds fewer routes (a ghost run hidden since) leaves no stale row behind. The
 * {@link DAY_MARKER} row goes too, until the run stores it again at the end. Matched on the
 * day's window, as the marker read is, so the day's rows go whatever start they were stamped with.
 * @param routeIds - The routes this run stored.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns The delete entry.
 */
export function staleVehicleSetDelete(
  routeIds: readonly string[],
  date: string,
): Prisma.InputJsonObject {
  return {
    q: { date: dateWindow(nzServiceDayRange(date)), routeId: { $nin: [...routeIds] } },
    limit: 0,
  };
}

/**
 * Read one completed service day's vehicles and store each route's set in DailyVehicleSet,
 * replacing whatever an earlier run stored for the day, then the {@link DAY_MARKER} row once
 * every route's row has landed, so a write that fails part way leaves the day unmarked and
 * the counts scan it live. Run after the ghost pass, whose hidden runs the read leaves out.
 * The rows follow the classification they were read under: a change to the ghost pass
 * needs the backfill re-run over the days it touched, as the daily summaries do.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns How many routes were stored.
 */
export async function writeVehicleSets(date: string): Promise<number> {
  const sets = await vehicleSetsOfDay(date);
  // A no-op once the indexes exist; without the unique one every upsert below would scan
  // the collection to find its row.
  await runCommand(() => prisma.$runCommandRaw(VEHICLE_SET_INDEXES));
  const cleared = await runCommand(() =>
    prisma.$runCommandRaw({
      delete: "DailyVehicleSet",
      deletes: [staleVehicleSetDelete([...sets.keys()], date)],
    }),
  );
  throwOnWriteErrors(cleared, [], "DailyVehicleSet clear");
  if (sets.size > 0) {
    const reply = await runCommand(() =>
      prisma.$runCommandRaw({
        update: "DailyVehicleSet",
        updates: vehicleSetUpsertOps(sets, date),
        ordered: false,
      }),
    );
    throwOnWriteErrors(reply, [], "DailyVehicleSet upsert");
  }
  const marked = await runCommand(() =>
    prisma.$runCommandRaw({
      update: "DailyVehicleSet",
      updates: vehicleSetUpsertOps(new Map([[DAY_MARKER, []]]), date),
    }),
  );
  throwOnWriteErrors(marked, [], "DailyVehicleSet day marker");
  return sets.size;
}
