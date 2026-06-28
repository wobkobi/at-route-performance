import { getJson } from "@/lib/at-static";
import { unstable_cache } from "@/lib/mem-cache";

// Raw GTFS trip attributes from AT v3 /stops/{id}/trips.
export interface StopTripAttr {
  trip_id: string;
  route_id: string;
  trip_headsign?: string | null;
  direction_id?: number | null;
  // "HH:MM:SS"; may exceed 23:59:59 for post-midnight GTFS extended times.
  departure_time?: string | null;
  [key: string]: unknown;
}

export interface ScheduledDeparture {
  tripId: string;
  routeId: string;
  headsign: string | null;
  directionId: number | null;
  departureTime: string | null;
}

/**
 * Fetch scheduled departures at a stop for a given service date.
 * AT path: /stops/{stopId}/trips with filter[date]=YYYY-MM-DD.
 * Sorted by departure_time ascending; zero-padded HH:MM:SS strings sort
 * correctly as plain strings, including GTFS extended times (e.g. "25:30:00").
 * AT stop IDs carry a hex version suffix (e.g. "7143-d5592a9b"); the trips
 * endpoint only recognises the base id, so the suffix is stripped before the call.
 * @param stopId - AT stop ID (with or without version suffix).
 * @param date - Service date as YYYY-MM-DD.
 * @returns Sorted scheduled departures, or an empty array when the stop has none.
 */
async function queryStopTrips(stopId: string, date: string): Promise<ScheduledDeparture[]> {
  const baseId = stopId.replace(/-[0-9a-f]+$/i, "");
  let page;
  try {
    page = await getJson<StopTripAttr>(`/stops/${encodeURIComponent(baseId)}/trips`, {
      "filter[date]": date,
    });
  } catch (err) {
    // 404 means the stop has no trips on this date or is not in the schedule.
    if (err instanceof Error && err.message.includes("404")) return [];
    throw err;
  }
  if (!page) return [];

  return page.data
    .map((d) => ({
      tripId: d.attributes.trip_id,
      routeId: d.attributes.route_id,
      headsign: d.attributes.trip_headsign ?? null,
      directionId: d.attributes.direction_id ?? null,
      departureTime: d.attributes.departure_time ?? null,
    }))
    .sort((a, b) => {
      if (!a.departureTime) return 1;
      if (!b.departureTime) return -1;
      return a.departureTime < b.departureTime ? -1 : a.departureTime > b.departureTime ? 1 : 0;
    });
}

/**
 * Cached scheduled departures at a stop for a given service date.
 * TTL is 300s for current-day queries and 3600s for past dates.
 * @param stopId - AT stop ID.
 * @param date - Service date as YYYY-MM-DD.
 * @returns Sorted scheduled departures.
 */
export async function getStopTrips(stopId: string, date: string): Promise<ScheduledDeparture[]> {
  const today = new Date().toISOString().slice(0, 10);
  const ttl = date >= today ? 300 : 3600;
  return unstable_cache(() => queryStopTrips(stopId, date), ["stop-trips", stopId, date], {
    revalidate: ttl,
  })();
}
