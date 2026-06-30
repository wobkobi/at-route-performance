// src/lib/at.ts
/**
 * @description Types and fetcher for AT's GTFS-RT trip-update feed. AT's JSON
 * deviates from the standard shape in ways the normaliser has to absorb: the
 * payload may be wrapped in a legacy `response` envelope, a single stop-time
 * update can arrive as an object rather than an array, and `delay` sometimes
 * sits at the trip_update root. The fetcher retries 429s and transient 5xx with
 * exponential backoff (capped at 60s) and a one-shot retry on the first
 * timeout/network blip, since AT's realtime endpoint rate-limits and stalls
 * under load.
 */
import { isObj, sleep } from "@/lib/utils";

export interface DelayTime {
  time?: number;
  delay?: number | null;
}
export interface StopTimeUpdate {
  stop_id: string;
  stop_sequence?: number;
  arrival?: DelayTime;
  departure?: DelayTime;
}
export interface Trip {
  trip_id: string;
  route_id: string;
  /** GTFS-RT schedule relationship: 0=SCHEDULED, 1=ADDED, 2=UNSCHEDULED, 3=CANCELED. */
  schedule_relationship?: number;
}
export interface TripUpdate {
  trip: Trip;
  stop_time_update?: StopTimeUpdate[] | StopTimeUpdate;
  timestamp?: number;
  delay?: number; // seen at root of trip_update in AT JSON
  vehicle?: { id?: string };
}
export interface Entity {
  id: string;
  trip_update?: TripUpdate;
}
export interface AtTripUpdates {
  header?: { timestamp?: number };
  entity: Entity[];
}

/**
 * Normalise AT feed shape (handles legacy `response.entity` and singular STU).
 * @param raw - Arbitrary JSON.
 * @returns Normalised feed.
 */
export function toTripUpdates(raw: unknown): AtTripUpdates {
  const root = isObj(raw) && isObj(raw.response) ? raw.response : raw;
  const entity =
    isObj(root) && Array.isArray((root as { entity?: unknown }).entity)
      ? ((root as { entity: unknown[] }).entity as Entity[])
      : [];
  // coerce STU to array if present as object
  for (const e of entity) {
    const tu = e.trip_update;
    if (tu && tu.stop_time_update && !Array.isArray(tu.stop_time_update)) {
      tu.stop_time_update = [tu.stop_time_update];
    }
  }
  const header =
    isObj(root) && isObj(root.header) ? (root.header as { timestamp?: number }) : undefined;
  return { header, entity };
}

const DEFAULT_AT_URL = "https://api.at.govt.nz/realtime/legacy/tripupdates";

/**
 * Fetch Auckland Transport GTFS-RT trip updates (JSON) with retry logic for 429s.
 * @param retries - Number of retry attempts (default: 3).
 * @returns Parsed and validated feed.
 * @throws {Error} If all retries are exhausted or a non-retryable error occurs.
 */
export async function fetchATTripUpdates(retries = 3): Promise<AtTripUpdates> {
  const key = process.env.AT_API_KEY ?? "";
  const url = process.env.AT_TRIPUPDATES_URL ?? DEFAULT_AT_URL;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000), // 15s timeout
      });

      // Retry rate limiting (429) and transient server errors (5xx) with backoff
      if (res.status === 429 || res.status >= 500) {
        const backoffMs = Math.min(60_000, 1000 * Math.pow(2, attempt)); // 1s, 2s, 4s, max 60s
        console.warn(
          `[AT API] ${res.status} ${res.statusText}. Retrying in ${backoffMs}ms... (attempt ${attempt + 1}/${retries + 1})`,
        );

        if (attempt < retries) {
          await sleep(backoffMs);
          continue; // Retry
        }
        throw new Error(`AT API ${res.status} after ${retries + 1} attempts`);
      }

      // Other errors are thrown immediately (no retry)
      if (!res.ok) {
        throw new Error(`AT API ${res.status} ${res.statusText}`);
      }

      const raw: unknown = await res.json();
      return toTripUpdates(raw);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on timeout or network errors unless it's the first attempt
      if (
        attempt === 0 &&
        (lastError.name === "TimeoutError" || lastError.message.includes("fetch"))
      ) {
        console.warn(`[AT API] ${lastError.message}. Retrying once...`);
        await sleep(2000);
        continue;
      }

      // Otherwise, throw immediately
      throw lastError;
    }
  }

  throw lastError || new Error("AT API fetch failed");
}
