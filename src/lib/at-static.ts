// src/lib/at-static.ts

// Base URL for AT GTFS v3 JSON:API.
const AT_V3 = "https://api.at.govt.nz/gtfs/v3";

// Shared headers for AT requests.
const H: Record<string, string> = {
  "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY ?? "",
  Accept: "application/vnd.api+json",
};

// JSON:API envelope.
export interface JsonApi<T> {
  data: Array<{ id: string; type: string; attributes: T }>;
}

// GTFS route attributes (subset).
export interface RouteAttr {
  route_id: string;
  route_short_name?: string | null;
  route_long_name: string;
  route_type: number;
}

// GTFS stop attributes (subset).
export interface StopAttr {
  stop_id: string;
  stop_code?: string | null;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
}

/**
 * GET helper for AT v3 JSON:API.
 * @template T Payload attribute type.
 * @param path Resource path, e.g. "/routes".
 * @param [qs] Optional query params.
 * @returns Parsed JSON:API response.
 * @throws {Error} Non-OK HTTP status.
 */
export async function getJson<T>(
  path: string,
  qs?: Record<string, string | number | undefined>
): Promise<JsonApi<T>> {
  const q = new URLSearchParams();
  if (qs)
    for (const [k, v] of Object.entries(qs))
      if (v !== undefined) q.set(k, String(v));
  const url = `${AT_V3}${path}${q.size ? `?${q}` : ""}`;
  const res = await fetch(url, { headers: H, cache: "no-store" });
  if (!res.ok) throw new Error(`AT v3 ${res.status} ${path}`);
  return (await res.json()) as JsonApi<T>;
}

/**
 * Fetch all routes.
 * @returns Route attributes array.
 */
export async function fetchRoutes(): Promise<RouteAttr[]> {
  const r = await getJson<RouteAttr>("/routes");
  return r.data.map((d) => d.attributes);
}

/**
 * Fetch stops for a service date.
 * @param [date] Service date YYYY-MM-DD. Defaults to API default.
 * @returns Stop attributes array.
 */
export async function fetchStops(date?: string): Promise<StopAttr[]> {
  const r = await getJson<StopAttr>("/stops", { "filter[date]": date });
  return r.data.map((d) => d.attributes);
}

/**
 * Map GTFS route_type to project mode enum.
 * 2→TRAIN, 3→BUS, 4→FERRY, else BUS.
 * @param routeType GTFS route_type.
 * @returns Mapped mode.
 */
export function mapRouteType(routeType: number): "BUS" | "TRAIN" | "FERRY" {
  if (routeType === 2) return "TRAIN";
  if (routeType === 4) return "FERRY";
  return "BUS";
}
