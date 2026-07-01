// src/lib/utils.ts
/**
 * @description General-purpose helpers - sleep, type guards and URL href building.
 */

/**
 * Sleep for a given number of milliseconds.
 * @param ms - Delay in milliseconds.
 * @returns A promise that resolves after the delay.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Type guard for a non-null object.
 * @param v - Value to test.
 * @returns True when `v` is a non-null object.
 */
export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Build a URL from a base path and a set of query params, skipping null,
 * undefined, and empty-string values. Params are emitted in object-key order, so
 * callers control the query-string order. Returns the bare base (no `?`) when no
 * param survives.
 * @param base - The path the URL points at (e.g. "/shame/trip").
 * @param params - Query params; falsy-empty entries are dropped.
 * @returns The href, e.g. "/shame/trip?window=week&mode=BUS".
 */
export function buildHref(base: string, params: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") p.set(k, v);
  }
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}
