// src/lib/mem-cache.ts
/**
 * @description Re-export the Next.js Data Cache (`unstable_cache`) plus an
 * in-process TTL store for the values it cannot hold. `unstable_cache` is
 * file-backed and shared across worker threads but only stores JSON-serialisable
 * data, so anything containing Maps or Sets goes through `memCache` instead - an
 * in-process store anchored to globalThis (per worker thread, survives
 * hot-reloads) that also dedupes concurrent in-flight fetches so a cold miss
 * fires exactly one upstream call. The `force-dynamic` layout disables only
 * route-level static generation, not these caches.
 */
// `unstable_cache` re-exported from `next/cache` so callers get the persistent
// Data Cache (file-backed, shared across Turbopack worker threads). The
// `force-dynamic` layout only disables route-level static generation; it does
// not bypass the Data Cache used by `unstable_cache`.
export { unstable_cache } from "next/cache";

interface Entry<T> {
  value: T;
  expiresAt: number;
}

// Anchored to globalThis as a secondary in-process TTL store for values that
// cannot be JSON-serialised by `unstable_cache` (Maps, Sets). Survives
// hot-reloads within the same worker thread; each worker thread starts with its
// own cold store.
const g = globalThis as typeof globalThis & {
  __memStore?: Map<string, Entry<unknown>>;
  __memInflight?: Map<string, Promise<unknown>>;
};
const store: Map<string, Entry<unknown>> = (g.__memStore ??= new Map());
const inflight: Map<string, Promise<unknown>> = (g.__memInflight ??= new Map());

/**
 * In-process TTL cache for values that cannot be stored in the Next.js Data
 * Cache because they contain non-JSON-serialisable types (Map, Set).
 * Deduplicates concurrent in-flight fetches for the same key so a cold miss
 * fires exactly one upstream call regardless of concurrency.
 * @param key - Stable string cache key.
 * @param ttlSec - Seconds before the entry expires and is re-fetched.
 * @param fn - Zero-argument async factory called on a cache miss.
 * @returns The cached or freshly fetched value.
 */
export async function memCache<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const missAt = Date.now();
  const promise = fn()
    .then((value) => {
      if (process.env.NODE_ENV === "development") {
        console.log(`[mem-cache miss] ${key} (${Date.now() - missAt}ms)`);
      }
      store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
      inflight.delete(key);
      return value;
    })
    .catch((err: unknown) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise;
}
