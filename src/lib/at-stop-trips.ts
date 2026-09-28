// src/lib/at-stop-trips.ts
// Fetches scheduled departures at a stop for a service date from AT's GTFS v3
// feed, and says which of four things happened, because on this endpoint they
// are not distinguishable from the response alone: a 404 is returned alike for a
// stop that does not exist, a stop with nothing scheduled in the window, and a
// date AT no longer publishes a timetable for.

import { AtHttpError, getJson } from "@/lib/at-static";
import { type FeedWindow, getFeedWindow, insideFeedWindow } from "@/lib/at-versions";
import { unstable_cache } from "@/lib/mem-cache";
import { gtfsServiceSeconds, nzServiceDayString, SERVICE_START_HOUR } from "@/lib/time";

// Raw GTFS attributes from AT v3 /stops/{id}/stoptrips. The key set is exactly
// this on every row.
export interface StopTripAttr {
  trip_id: string;
  route_id: string;
  stop_id: string;
  trip_headsign?: string | null;
  /** AT's own words for where this departure goes, shouted in caps on buses. */
  stop_headsign?: string | null;
  direction_id?: number | null;
  /** 0 when a rider can board here; 1 when the vehicle only sets down. */
  pickup_type?: number | null;
  drop_off_type?: number | null;
  // "HH:MM:SS"; may exceed 23:59:59 for post-midnight GTFS extended times.
  departure_time?: string | null;
  [key: string]: unknown;
}

/** One boardable departure from a stop, as the board renders it. */
export interface ScheduledDeparture {
  tripId: string;
  routeId: string;
  /** The platform it leaves from, since a station is fetched in one call. */
  stopId: string;
  /** `trip_headsign`: the spelled-out "<origin> To <destination> Via <road>". */
  headsign: string | null;
  /** `stop_headsign`: AT's short form, the fallback for a loop or Link service. */
  stopHeadsign: string | null;
  directionId: number | null;
  departureTime: string | null;
}

/**
 * What a departures lookup produced. The three failures are separate states
 * rather than an empty list because they mean different things to a reader, and
 * AT answers all of them with the same 404 body.
 */
export type StopDepartures =
  | { status: "ok"; departures: ScheduledDeparture[] }
  | { status: "no-service" }
  | { status: "outside-feed"; window: FeedWindow }
  | { status: "unavailable" };

/** AT's own bounds on the stoptrips hour filters: both are 1 to 30 inclusive. */
const MIN_START_HOUR = 1;
const MAX_HOUR_RANGE = 30;

/**
 * The stoptrips window covering one whole service day, in GTFS extended hours.
 *
 * The range is AT's maximum rather than a measured tail. 24 is wrong: a
 * `[04:00, 28:00)` window drops a 28:00:00 departure that genuinely runs, and a
 * wider window returns the same rows for the same single call, so trimming buys
 * nothing. The `Math.max` is a guard rather than an assertion - AT rejects
 * `start_hour=0` with a 400, so a future 4am-to-midnight change must clamp.
 * @param date - Service date as `YYYY-MM-DD`.
 * @returns The date and hour filters for one stoptrips call.
 */
export function serviceDayWindow(date: string): {
  date: string;
  startHour: number;
  hourRange: number;
} {
  return {
    date,
    startHour: Math.max(MIN_START_HOUR, SERVICE_START_HOUR),
    hourRange: MAX_HOUR_RANGE,
  };
}

/**
 * Order departures through the service day, 4am first: by
 * {@link gtfsServiceSeconds}, so a post-midnight "00:30:00" follows "23:50:00"
 * rather than opening the list. Departures with no time go last.
 *
 * AT returns the rows already in this order, including across every platform of
 * a station, but that is measured rather than promised, so the sort stays.
 * @param a - One departure.
 * @param b - The other.
 * @returns Negative, zero or positive, for `Array.prototype.sort`.
 */
export function byServiceDeparture(a: ScheduledDeparture, b: ScheduledDeparture): number {
  const at = a.departureTime ? gtfsServiceSeconds(a.departureTime) : null;
  const bt = b.departureTime ? gtfsServiceSeconds(b.departureTime) : null;
  if (at === null) return bt === null ? 0 : 1;
  if (bt === null) return -1;
  return at - bt;
}

/**
 * Fetch a stop's boardable departures for a service date.
 *
 * The id must be AT's **full versioned id**; the base id answers 404 here, which
 * is the reverse of the endpoint this replaced. A parent station id answers for
 * every platform under it in one call, so a station costs one request rather
 * than one per platform.
 *
 * Rows a rider cannot board are dropped: roughly half of them are set-down only,
 * at an ordinary pole as much as at an interchange, and they would otherwise
 * fill the board with vehicles nobody can get on. Dropping them also removes the
 * only reason a trip appeared twice, so there is no dedupe here.
 * @param stopId - AT stop id, with its version suffix.
 * @param date - Service date as `YYYY-MM-DD`.
 * @returns The boardable departures, or "no-service" when AT has none.
 * @throws {Error} When AT cannot be reached or answers anything but 404.
 */
async function queryStopTrips(
  stopId: string,
  date: string,
): Promise<ScheduledDeparture[] | "no-service"> {
  const window = serviceDayWindow(date);
  let page;
  try {
    page = await getJson<StopTripAttr>(`/stops/${encodeURIComponent(stopId)}/stoptrips`, {
      "filter[date]": window.date,
      "filter[start_hour]": String(window.startHour),
      "filter[hour_range]": String(window.hourRange),
    });
  } catch (err) {
    // Read the status, not the message: the message carries the URL, so a stop
    // id such as "1404" made every failure there look like an empty schedule.
    if (err instanceof AtHttpError && err.status === 404) return "no-service";
    throw err;
  }
  if (!page) return "no-service";

  return page.data
    .filter((d) => d.attributes.pickup_type === 0)
    .map((d) => ({
      tripId: d.attributes.trip_id,
      routeId: d.attributes.route_id,
      stopId: d.attributes.stop_id,
      headsign: d.attributes.trip_headsign ?? null,
      stopHeadsign: d.attributes.stop_headsign ?? null,
      directionId: d.attributes.direction_id ?? null,
      departureTime: d.attributes.departure_time ?? null,
    }))
    .sort(byServiceDeparture);
}

/**
 * Cache TTL for a stop's departures on a service date: five minutes while the
 * date is today or later (AT can still revise the schedule), an hour once it
 * is past. "Today" is the NZ service date, not the UTC calendar date: from
 * midnight UTC to 4am NZ the two differ, and comparing to the UTC date treated
 * every NZ morning's lookups as past days, refreshing an hour later than
 * intended and, for the day just ended, twelve times as often as needed.
 * @param date - Service date as `YYYY-MM-DD`.
 * @param now - The current instant (injectable for tests).
 * @returns The TTL in seconds.
 */
export function stopTripsTtl(date: string, now: Date = new Date()): number {
  return date >= nzServiceDayString(now) ? 300 : 3600;
}

/**
 * A stop's departures for a service date, and which of the four states applies.
 *
 * A date outside AT's published window is answered without calling AT at all:
 * the call would 404, and that 404 is indistinguishable from "nothing runs
 * here", so the reader would be told the stop was quiet on a day whose timetable
 * has simply been retired. The site keeps arrivals far longer than AT keeps
 * timetables, so this is an ordinary state for an older day, not an edge case.
 *
 * Only a real answer is cached. A failure throws through the cache, so a
 * timeout is retried on the next render instead of being held for the TTL.
 * @param stopId - AT stop id, with its version suffix.
 * @param date - Service date as `YYYY-MM-DD`.
 * @returns The departures, or the state that stopped them being read.
 */
export async function getStopDepartures(stopId: string, date: string): Promise<StopDepartures> {
  const window = await getFeedWindow();
  if (window !== null && !insideFeedWindow(window, date)) {
    return { status: "outside-feed", window };
  }
  try {
    const result = await unstable_cache(
      () => queryStopTrips(stopId, date),
      ["stop-trips-v2", stopId, date],
      { revalidate: stopTripsTtl(date) },
    )();
    return result === "no-service"
      ? { status: "no-service" }
      : { status: "ok", departures: result };
  } catch {
    // Deliberately not logged through the database marker: an AT outage is an
    // ordinary state the page renders, and logging it there would bury the
    // signal that marker exists for.
    return { status: "unavailable" };
  }
}
