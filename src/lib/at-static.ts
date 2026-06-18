// src/lib/at-static.ts

// Base URL for AT GTFS v3 JSON:API.
const AT_V3 = "https://api.at.govt.nz/gtfs/v3";

// Shared headers for AT requests.
const H: Record<string, string> = {
  "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY ?? "",
  Accept: "application/vnd.api+json",
};

const MAX_ATTEMPTS = 4;

// JSON:API envelope.
export interface JsonApi<T> {
  data: Array<{ id: string; type: string; attributes: T }>;
  links?: { next?: string | null };
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
 * Sleep for a given number of milliseconds.
 * @param ms - Delay in milliseconds.
 * @returns A promise that resolves after the delay.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch an absolute AT v3 URL as JSON:API, retrying 429/5xx and network/timeout
 * errors with exponential backoff (1s, 2s, 4s; capped at 60s).
 * @template T - Payload attribute type.
 * @param url - Absolute request URL.
 * @returns Parsed JSON:API response.
 * @throws {Error} On a non-retryable status or once attempts are exhausted.
 */
async function fetchJson<T>(url: string): Promise<JsonApi<T>> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: H,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 429 || res.status >= 500) {
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(Math.min(60_000, 1000 * 2 ** attempt));
          continue;
        }
        throw new Error(`AT v3 ${res.status} ${url}`);
      }
      if (!res.ok) throw new Error(`AT v3 ${res.status} ${url}`);
      return (await res.json()) as JsonApi<T>;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const retryable = lastError.name === "TimeoutError" || lastError.message.includes("fetch");
      if (retryable && attempt < MAX_ATTEMPTS - 1) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error("AT v3 fetch failed");
}

/**
 * GET helper for AT v3 JSON:API.
 * @template T - Payload attribute type.
 * @param path - Resource path, e.g. "/routes".
 * @param qs - Optional query params.
 * @returns Parsed JSON:API response.
 */
export async function getJson<T>(
  path: string,
  qs?: Record<string, string | number | undefined>,
): Promise<JsonApi<T>> {
  const q = new URLSearchParams();
  if (qs) for (const [k, v] of Object.entries(qs)) if (v !== undefined) q.set(k, String(v));
  return fetchJson<T>(`${AT_V3}${path}${q.size ? `?${q}` : ""}`);
}

/**
 * Fetch every page of a JSON:API collection by following `links.next`.
 * @template T - Payload attribute type.
 * @param path - Resource path, e.g. "/routes".
 * @param qs - Optional query params for the first request.
 * @returns Flattened attributes from all pages.
 */
export async function fetchAll<T>(
  path: string,
  qs?: Record<string, string | number | undefined>,
): Promise<T[]> {
  const out: T[] = [];
  let page = await getJson<T>(path, qs);
  out.push(...page.data.map((d) => d.attributes));

  let next = page.links?.next ?? null;
  let guard = 0;
  while (next && guard++ < 1000) {
    const url = next.startsWith("http") ? next : `${AT_V3}${next}`;
    page = await fetchJson<T>(url);
    out.push(...page.data.map((d) => d.attributes));
    next = page.links?.next ?? null;
  }
  return out;
}

/**
 * Fetch all routes (following pagination).
 * @returns Route attributes array.
 */
export async function fetchRoutes(): Promise<RouteAttr[]> {
  return fetchAll<RouteAttr>("/routes");
}

/**
 * Fetch all stops for a service date (following pagination).
 * @param date - Service date YYYY-MM-DD. Defaults to the API default.
 * @returns Stop attributes array.
 */
export async function fetchStops(date?: string): Promise<StopAttr[]> {
  return fetchAll<StopAttr>("/stops", { "filter[date]": date });
}

/**
 * Map GTFS route_type to project mode enum.
 * 2→TRAIN, 3→BUS, 4→FERRY, else BUS.
 * @param routeType - GTFS route_type.
 * @returns Mapped mode.
 */
export function mapRouteType(routeType: number): "BUS" | "TRAIN" | "FERRY" {
  if (routeType === 2) return "TRAIN";
  if (routeType === 4) return "FERRY";
  return "BUS";
}
