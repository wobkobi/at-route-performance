// src/lib/at.ts
/** GTFS-RT types */
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
}
export interface TripUpdate {
  trip: Trip;
  stop_time_update?: StopTimeUpdate[];
  timestamp?: number;
}
export interface Entity {
  id: string;
  trip_update?: TripUpdate;
}

export interface AtTripUpdates {
  header?: { timestamp?: number };
  entity: Entity[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const isDelayTime = (v: unknown): v is DelayTime =>
  isRecord(v) &&
  (v.time === undefined || isNumber(v.time)) &&
  (v.delay === undefined || v.delay === null || isNumber(v.delay));

const isStopTimeUpdate = (v: unknown): v is StopTimeUpdate =>
  isRecord(v) &&
  isString(v.stop_id) &&
  (v.stop_sequence === undefined || isNumber(v.stop_sequence)) &&
  (v.arrival === undefined || isDelayTime(v.arrival)) &&
  (v.departure === undefined || isDelayTime(v.departure));

const isTrip = (v: unknown): v is Trip =>
  isRecord(v) && isString(v.trip_id) && isString(v.route_id);

const isTripUpdate = (v: unknown): v is TripUpdate =>
  isRecord(v) &&
  isTrip(v.trip) &&
  (v.timestamp === undefined || isNumber(v.timestamp)) &&
  (v.stop_time_update === undefined ||
    (Array.isArray(v.stop_time_update) &&
      v.stop_time_update.every(isStopTimeUpdate)));

const isEntity = (v: unknown): v is Entity =>
  isRecord(v) &&
  isString((v as { id?: unknown }).id) &&
  (v.trip_update === undefined || isTripUpdate(v.trip_update));

/**
 * Parse unknown JSON into a normalized AT feed.
 * Accepts `{ entity }` or `{ response: { entity } }`.
 * @param raw Arbitrary JSON.
 * @returns Normalized feed.
 */
export function toTripUpdates(raw: unknown): AtTripUpdates {
  const header =
    isRecord(raw) && isRecord(raw.header) && isNumber(raw.header.timestamp)
      ? { timestamp: raw.header.timestamp }
      : undefined;

  const entitiesSrc: unknown =
    isRecord(raw) && Array.isArray(raw.entity)
      ? raw.entity
      : isRecord(raw) &&
          isRecord(raw.response) &&
          Array.isArray(raw.response.entity)
        ? raw.response.entity
        : [];

  const entity: Entity[] = Array.isArray(entitiesSrc)
    ? entitiesSrc.filter(isEntity)
    : [];

  return { header, entity };
}

// switch to JSON response; legacy often returns protobuf
const DEFAULT_AT_URL =
  "https://api.at.govt.nz/v2/public/realtime/tripupdates?format=json";

/**
 * Fetch Auckland Transport GTFS-RT trip updates.
 * @returns Parsed and validated feed.
 * @throws {Error} Non-OK HTTP or invalid JSON.
 */
export async function fetchATTripUpdates(): Promise<AtTripUpdates> {
  const key = process.env.AT_API_KEY;
  if (!key) throw new Error("AT_API_KEY missing");

  const url = process.env.AT_TRIPUPDATES_URL ?? DEFAULT_AT_URL;

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 10_000);

  try {
    const res = await fetch(url, {
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`AT ${res.status}`);
    const raw: unknown = await res.json();
    return toTripUpdates(raw);
  } finally {
    clearTimeout(timeout);
  }
}
