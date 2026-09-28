// src/lib/departure-board.ts
// Which of a service day's departures a board draws. A whole day is a long
// table - 107 rows at one New Lynn platform, roughly 844 across the station - so
// today opens on what is still to come and keeps the rest one click away.

import type { ScheduledDeparture } from "@/lib/at-stop-trips";
import {
  gtfsServiceSeconds,
  nzServiceDayRange,
  nzServiceDayString,
  serviceDayClockSeconds,
} from "@/lib/time";

/**
 * Where "now" falls on a service day's GTFS clock, in the same seconds
 * {@link gtfsServiceSeconds} returns - so 12:30am reads as 88,200 rather than
 * 1,800 and sorts after the evening, as the departures themselves do.
 * @param serviceDate - The service date being shown (`YYYY-MM-DD`).
 * @param now - The instant to place (injectable for tests).
 * @returns The seconds, or null when the shown day is not the one running.
 */
export function serviceClockNow(serviceDate: string, now: Date = new Date()): number | null {
  if (nzServiceDayString(now) !== serviceDate) return null;
  return serviceDayClockSeconds(nzServiceDayRange(now).start, now);
}

/**
 * The departures still to come at a point in the service day. A row AT gave no
 * time is kept rather than dropped: it cannot be placed on the clock, and
 * hiding a real departure is worse than listing one out of order.
 * @param departures - The day's departures, in service order.
 * @param fromSeconds - The GTFS-clock second to start from.
 * @returns The departures at or after that second.
 */
export function departuresFromNow(
  departures: readonly ScheduledDeparture[],
  fromSeconds: number,
): ScheduledDeparture[] {
  return departures.filter((d) => {
    const at = d.departureTime === null ? null : gtfsServiceSeconds(d.departureTime);
    return at === null || at >= fromSeconds;
  });
}
