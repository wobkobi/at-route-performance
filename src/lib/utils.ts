// src/lib/utils.ts
// General-purpose helpers - sleep, type guards and URL href building.

/**
 * Sleep for a given number of milliseconds.
 * @param ms - Delay in milliseconds.
 * @returns A promise that resolves after the delay.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a promise up to a deadline. The promise keeps running past it, so its
 * work (a cache fill, say) still lands for a later caller. A rejection before the
 * deadline rejects; one after it reaches no one here, so give the promise its own catch.
 * @param promise - The work to wait for.
 * @param ms - The deadline, in milliseconds.
 * @returns The promise's value, or null once the deadline passes first.
 */
export function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** A promise's outcome after a head start: its value, or still running. */
export type HeadStart<T> = { settled: true; value: T } | { settled: false };

/**
 * Give a promise a short head start before choosing how to render it. A component
 * that awaits a promise always streams in its own later chunk, even when the
 * promise has already settled, so a cached read rendered that way still pops in
 * after the content around it. Render a settled value in place and stream only
 * what is still running. Unlike {@link settleWithin}, a value of null still counts
 * as settled. A rejection inside the head start rejects, so pass a caught promise.
 * @param promise - The work, already started.
 * @param ms - The head start, in milliseconds; 0 still lets an already-settled promise through.
 * @returns The value once settled in time, or `{ settled: false }` with the promise still running.
 */
export function headStart<T>(promise: Promise<T>, ms: number): Promise<HeadStart<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<HeadStart<T>>((resolve) => {
    timer = setTimeout(() => resolve({ settled: false }), ms);
  });
  const settled = promise.then((value): HeadStart<T> => ({ settled: true, value }));
  return Promise.race([settled, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Exponential backoff for a retried AT request: 1s, 2s, 4s and so on, capped at 60s.
 * @param attempt - The zero-based attempt that just failed.
 * @returns The wait before the next attempt, in milliseconds.
 */
export function retryDelay(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** attempt);
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

/**
 * Drop the unset entries from a param set, for a control that takes only set
 * params to preserve.
 * @param params - The params, some unset.
 * @returns The set ones.
 */
export function stripUnset(params: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined),
  );
}
