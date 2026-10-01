// src/lib/data/shame-day-hours.ts
// The hours any of the three shame day boards has a row for, so each board can cover the same span.
import type { ShameFilter } from "@/lib/data/shame-filter";
import { getRouteBoardOfDay } from "@/lib/data/shame-routes";
import { getStopBoardOfDay } from "@/lib/data/shame-stops";
import { getTripBoardOfDay } from "@/lib/data/shame-trips";
import type { DateRange } from "@/lib/time/service-day";

/**
 * Every hour of day holding a row on the trips, routes or stops day board. Each
 * board's query is cached with the same arguments its own page uses, so the
 * page's own board costs nothing extra here.
 * @param range - The service-day window.
 * @param filter - Mode/school filters, as the boards take them.
 * @param revalidate - Cache lifetime in seconds.
 * @returns The distinct hours, in no particular order.
 */
export async function getShameDayHours(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<number[]> {
  const [trips, routes, stops] = await Promise.all([
    getTripBoardOfDay(range, filter, revalidate),
    getRouteBoardOfDay(range, filter, revalidate),
    getStopBoardOfDay(range, filter, revalidate),
  ]);
  const hours = [...trips.hours, ...routes.hours, ...stops.hours].map((h) => h.hour);
  return [...new Set(hours)];
}
