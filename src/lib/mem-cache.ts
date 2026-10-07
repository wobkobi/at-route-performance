// src/lib/mem-cache.ts
// Re-export the Next.js Data Cache (`unstable_cache`) plus an
// in-process TTL store for what it cannot do. `unstable_cache` is file-backed and
// shared across worker threads but only stores JSON-serialisable data, and a call
// nested inside another's callback skips its read. `memCache` is an in-process
// store anchored to globalThis (per worker thread, survives hot-reloads) for values
// holding Maps or Sets and for a value built from per-day Data Cache reads; it also
// dedupes concurrent in-flight fetches so a cold miss fires exactly one upstream
// call. `sharedInFlight` keeps no value, only one running read per key. The
// `force-dynamic` layout disables only route-level static generation, not these caches.

import { READ_TIMING } from "@/lib/read-timing";
import { unstable_cache as nextCache } from "next/cache";

/**
 * Leads every Data Cache key. Entries persist across deployments, and a key is
 * built from the wrapper callback's source and its parts, neither of which
 * changes when the data function behind it returns a new shape. Bump this
 * whenever a cached value's fields are renamed or restructured, or a deploy
 * serves the old shape until each entry expires.
 */
const SHAPE_VERSION = "s5";

/**
 * The Next.js Data Cache (file-backed, shared across Turbopack worker threads),
 * with {@link SHAPE_VERSION} leading its key. The `force-dynamic` layout only
 * disables route-level static generation; it does not bypass this cache.
 * @param cb - The data function to cache.
 * @param keyParts - Parts that make the key unique to the query.
 * @param options - Revalidate time and tags.
 * @returns The cached function.
 */
export const unstable_cache: typeof nextCache = (cb, keyParts, options) =>
  nextCache(cb, [SHAPE_VERSION, ...(keyParts ?? [])], options);

interface Entry<T> {
  value: T;
  expiresAt: number;
}

// Anchored to globalThis as a secondary in-process TTL store. Survives hot-reloads
// within the same worker thread; each worker thread starts with its own cold store.
const g = globalThis as typeof globalThis & {
  __memStore?: Map<string, Entry<unknown>>;
  __memInflight?: Map<string, Promise<unknown>>;
};
const store: Map<string, Entry<unknown>> = (g.__memStore ??= new Map());
const inflight: Map<string, Promise<unknown>> = (g.__memInflight ??= new Map());

/**
 * Drop every expired entry. Keys that carry a date are never asked for again once the
 * day turns over, so without a sweep they would stay in memory for the life of the
 * process.
 * @param now - The current time, in epoch milliseconds.
 */
function sweepExpired(now: number): void {
  for (const [key, entry] of store) if (entry.expiresAt <= now) store.delete(key);
}

/**
 * In-process TTL cache for values the Next.js Data Cache cannot hold: values
 * containing non-JSON-serialisable types (Map, Set), and values built from per-day
 * Data Cache reads, which would skip their cached values if called inside another
 * Data Cache entry. Expired entries are swept on each write. Deduplicates
 * concurrent in-flight fetches for the same key so a cold miss fires exactly one
 * upstream call regardless of concurrency.
 * @param key - Stable string cache key.
 * @param ttlSec - Seconds before the entry expires and is re-fetched, or a function of the
 *   fetched value giving them, so an empty answer can be held for less time than a full one.
 * @param fn - Zero-argument async factory called on a cache miss.
 * @returns The cached or freshly fetched value.
 */
export async function memCache<T>(
  key: string,
  ttlSec: number | ((value: T) => number),
  fn: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const missAt = Date.now();
  const promise = fn()
    .then((value) => {
      if (process.env.NODE_ENV === "development" || READ_TIMING) {
        console.log(`[MEM-CACHE] miss ${key} (${Date.now() - missAt}ms)`);
      }
      const settledAt = Date.now();
      sweepExpired(settledAt);
      const ttl = typeof ttlSec === "function" ? ttlSec(value) : ttlSec;
      store.set(key, { value, expiresAt: settledAt + ttl * 1000 });
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

const shared: Map<string, Promise<unknown>> = new Map();

/**
 * Share one running read between concurrent callers with the same key, and keep
 * nothing once it settles. For reads with a cache of their own (the Data Cache)
 * that two parts of a page start at once: two concurrent misses would each run
 * the query, while holding the value here as well would only duplicate it.
 * @param key - Stable string key for the read.
 * @param fn - Zero-argument async read.
 * @returns The running read's result.
 */
export function sharedInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = shared.get(key) as Promise<T> | undefined;
  if (running) return running;
  const promise = fn().finally(() => shared.delete(key));
  shared.set(key, promise);
  return promise;
}
