// src/lib/route-slug.ts

/**
 * Strip the trailing GTFS feed-version suffix from an AT route id, yielding a
 * stable, version-independent slug for URLs ("501-217" -> "501", "S015C-203" ->
 * "S015C"). AT bumps the suffix when a route's schedule changes, which would
 * otherwise break shared links and split a route's history across ids. Routes
 * that differ only by their suffix are the same route across republishes.
 * @param routeId - A full AT route id (or an already-stripped slug).
 * @returns The version-stripped slug.
 */
export function routeSlug(routeId: string): string {
  return routeId.replace(/-\d+$/, "");
}

/**
 * The numeric feed version encoded in a route id's suffix ("501-217" -> 217), or
 * 0 when the id carries no suffix. Lets callers pick the most recent version.
 * @param routeId - A full AT route id.
 * @returns The trailing version number, or 0.
 */
export function routeVersion(routeId: string): number {
  return Number.parseInt(/-(\d+)$/.exec(routeId)?.[1] ?? "0", 10);
}
