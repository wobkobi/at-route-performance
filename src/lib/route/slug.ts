// src/lib/route/slug.ts
// Map an AT route id to a stable URL slug by stripping its trailing
// GTFS feed-version suffix ("501-217" > "501"). AT bumps that suffix whenever a
// route's schedule republishes, which would otherwise break shared links and
// split one route's history across many ids; routes that differ only by suffix
// are the same route. The companion helper reads the suffix back out as a number
// so callers can pick the most recent feed version.

import type { Mode } from "@/lib/mode";
import { lineName } from "@/lib/route/line-name";

/** How a route is named and drawn: the fields every route row carries. */
export interface RouteDisplay {
  /** AT's route id, feed-version suffix included ("NX1-203"); {@link routeSlug} strips it. */
  routeId: string;
  /** The number riders know the route by ("NX1"), or null when AT gives none. */
  shortName: string | null;
  /** AT's long name, or an empty string when the route's record is missing. */
  longName: string;
  mode: Mode;
  /** AT's brand colour hex without `#`, or null when unset; absent when not read. */
  colour?: string | null;
}

/**
 * Strip the trailing GTFS feed-version suffix from an AT route id, yielding a
 * stable, version-independent slug for URLs ("501-217" > "501", "S015C-203" >
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
 * The numeric feed version encoded in a route id's suffix ("501-217" > 217), or
 * 0 when the id carries no suffix. Lets callers pick the most recent version.
 * @param routeId - A full AT route id.
 * @returns The trailing version number, or 0.
 */
export function routeVersion(routeId: string): number {
  return Number.parseInt(/-(\d+)$/.exec(routeId)?.[1] ?? "0", 10);
}

/** The fields a route's name is read from; rows carry either the id or the slug. */
export type RouteNameFields = {
  shortName?: string | null;
  longName?: string | null;
  mode?: string;
} & ({ routeId: string } | { slug: string });

/**
 * The name a route goes by: the number riders know ("NX1"), else AT's long
 * name, else its slug. `||` rather than `??`, since AT sends empty strings as
 * well as nulls.
 * @param r - The route.
 * @returns The name.
 */
export function routeDisplayName(r: RouteNameFields): string {
  return r.shortName || r.longName || ("slug" in r ? r.slug : routeSlug(r.routeId));
}

/**
 * The second line under a route's name: a train's published line name, else
 * AT's long name, or null when that would repeat the name itself. AT sets every
 * train route's long name to its bare code ("STH"), which is why the line name
 * comes first.
 * @param r - The route.
 * @returns The subtitle, or null.
 */
export function routeSubtitle(r: RouteNameFields): string | null {
  const sub = (r.mode ? lineName(r.mode, r.shortName) : null) ?? r.longName;
  return sub && sub !== routeDisplayName(r) ? sub : null;
}

/**
 * Order route numbers the way riders read them: "2" before "10", "70" before
 * "70X". The one comparator every route list sorts with.
 * @param a - A route's short name or slug.
 * @param b - Another.
 * @returns Negative, zero or positive, as for `Array.prototype.sort`.
 */
export function compareRouteNumbers(a: string, b: string): number {
  return a.localeCompare(b, "en-NZ", { numeric: true });
}
