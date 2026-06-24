// src/lib/at.ts
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
 * Type guard for a non-null object.
 * @param v - Value to test.
 * @returns True when `v` is a non-null object.
 */
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * Normalize AT feed shape (handles legacy `response.entity` and singular STU).
 * @param raw - Arbitrary JSON.
 * @returns Normalized feed.
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
 * Sleep for a given number of milliseconds.
 * @param ms - Delay in milliseconds.
 * @returns A promise that resolves after the delay.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
