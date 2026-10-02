// Link builders for the entity pages. Every link to a route, stop, vehicle,
// trip or operator goes through here, so each one slugs the route, encodes its
// ids and drops unset params the same way.
import { routeSlug } from "@/lib/route/slug";
import { buildHref } from "@/lib/utils";
import { redirect } from "next/navigation";

export { operatorHref } from "@/lib/operators";

/** Query params for a link; null, undefined and empty values are left out. */
export type LinkQuery = Record<string, string | null | undefined>;

/**
 * A route's page. Takes a versioned route id or a slug: either way the link
 * names the slug, so it lands on the canonical URL without a redirect.
 * @param routeId - The route id ("70-203") or slug ("70").
 * @param query - Params the link carries.
 * @returns The href.
 */
export function routeHref(routeId: string, query: LinkQuery = {}): string {
  return buildHref(`/route/${encodeURIComponent(routeSlug(routeId))}`, query);
}

/**
 * A stop's (or station's) page.
 * @param stopId - The stop or station id.
 * @param query - Params the link carries.
 * @returns The href.
 */
export function stopHref(stopId: string, query: LinkQuery = {}): string {
  return buildHref(`/stop/${encodeURIComponent(stopId)}`, query);
}

/**
 * A vehicle's page.
 * @param vehicleId - The feed vehicle id.
 * @param query - Params the link carries.
 * @returns The href.
 */
export function vehicleHref(vehicleId: string, query: LinkQuery = {}): string {
  return buildHref(`/vehicle/${encodeURIComponent(vehicleId)}`, query);
}

/**
 * One trip's page. `at` becomes `?d=`, which the trip page reads as either the
 * trip's scheduled start (an instant) or a bare service date; both forms are
 * kept, since trip links are shared and must keep resolving.
 * @param routeId - The route id or slug the trip ran on.
 * @param tripId - The GTFS trip id.
 * @param at - The scheduled start or service date, or null for the latest run.
 * @param query - Further params the link carries.
 * @returns The href.
 */
export function tripHref(
  routeId: string,
  tripId: string,
  at?: string | null,
  query: LinkQuery = {},
): string {
  const path = `/route/${encodeURIComponent(routeSlug(routeId))}/trip/${encodeURIComponent(tripId)}`;
  return buildHref(path, { d: at, ...query });
}

/**
 * The same page's URL with its query kept, minus the named params and with
 * `add` appended, for a redirect that should not lose the reader's filters.
 * @param path - The path to send the reader to.
 * @param sp - The page's search params; only string values carry.
 * @param drop - Params to leave out.
 * @param add - Params to set, after the kept ones.
 * @returns The href.
 */
export function hrefKeepingQuery(
  path: string,
  sp: object,
  drop: readonly string[] = [],
  add: LinkQuery = {},
): string {
  const kept: LinkQuery = {};
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string" && !drop.includes(k)) kept[k] = v;
  }
  return buildHref(path, { ...kept, ...add });
}

/**
 * Redirect to {@link hrefKeepingQuery}'s URL. Throws the redirect (Next
 * navigation), so call it before rendering.
 * @param path - The path to send the reader to.
 * @param sp - The page's search params; only string values carry.
 * @param drop - Params to leave out.
 * @param add - Params to set, after the kept ones.
 */
export function redirectKeepingQuery(
  path: string,
  sp: object,
  drop: readonly string[] = [],
  add: LinkQuery = {},
): never {
  redirect(hrefKeepingQuery(path, sp, drop, add));
}
