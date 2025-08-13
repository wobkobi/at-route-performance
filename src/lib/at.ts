export interface AtTripUpdates {
  header: { timestamp: number };
  entity: Array<{
    id: string;
    trip_update?: {
      trip: { trip_id: string; route_id: string };
      stop_time_update?: Array<{
        stop_id: string;
        stop_sequence?: number;
        arrival?: { time?: number; delay?: number };
        departure?: { time?: number; delay?: number };
      }>;
      timestamp?: number;
    };
  }>;
}

/**
 * Fetch Auckland Transport GTFS-RT trip updates.
 * @returns Parsed trip-updates feed.
 * @throws {Error} When the HTTP response is not OK.
 */
export async function fetchATTripUpdates(): Promise<AtTripUpdates> {
  const res = await fetch(
    "https://api.at.govt.nz/realtime/legacy/tripupdates",
    {
      headers: { "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY ?? "" },
    }
  );
  if (!res.ok) throw new Error(`AT ${res.status}`);
  return res.json() as Promise<AtTripUpdates>;
}
