// src/lib/live-routes.ts
// What is running right now, folded from one read of AT's vehicle feed: each
// route's vehicles on a run and how they sit against the on-time window. Pure,
// so the live page, the Routes "running now" filter and the tests share one fold.

import { delayBand } from "@/lib/on-time";
import { routeSlug } from "@/lib/route-slug";
import type { LiveVehicle } from "@/lib/vehicles";

/** A transport mode as the route table stores it. */
export type LiveMode = "BUS" | "TRAIN" | "FERRY";

/** One route with vehicles on a run now. */
export interface LiveRouteRow {
  /** Version-stripped route slug, for links. */
  slug: string;
  mode: LiveMode;
  /** Vehicles on a run. */
  vehicles: number;
  late: number;
  onTime: number;
  early: number;
  /** Vehicles the trip feed gave no delay for. */
  unknown: number;
  /** Mean signed delay over the vehicles with one, or null when none has one. */
  avgDelaySec: number | null;
}

/** How the live table can be ordered. */
export type LiveSort = "running" | "late";

/**
 * Read the live table's sort from its query param.
 * @param raw - The `sort` param.
 * @returns The sort, "running" for anything unknown.
 */
export function parseLiveSort(raw: string | undefined): LiveSort {
  return raw === "late" ? "late" : "running";
}

/**
 * The vehicles on a run: the feed also lists vehicles with a route but no trip,
 * which are parked or between runs and say nothing about service now.
 * @param vehicles - Every vehicle in the feed.
 * @returns The ones carrying a trip.
 */
export function onARun(vehicles: readonly LiveVehicle[]): LiveVehicle[] {
  return vehicles.filter((v) => v.tripId != null);
}

/**
 * Slugs of the routes with a vehicle on a run, for the Routes page filter.
 * @param vehicles - Every vehicle in the feed.
 * @returns The route slugs, sorted.
 */
export function liveRouteSlugs(vehicles: readonly LiveVehicle[]): string[] {
  return [...new Set(onARun(vehicles).map((v) => routeSlug(v.routeId)))].sort();
}

/**
 * Fold the feed into one row per route running now, each vehicle banded on its
 * route's mode window. AT versions route ids ("NX1-202409"), so rows key on the
 * slug and two versions of one line share a row.
 * @param vehicles - Every vehicle in the feed.
 * @param modeOf - Route id > mode; a route missing from it counts as a bus.
 * @param sort - "running" puts the most vehicles first, "late" the most late.
 * @returns The rows, ties broken by route number.
 */
export function liveRoutes(
  vehicles: readonly LiveVehicle[],
  modeOf: ReadonlyMap<string, string>,
  sort: LiveSort = "running",
): LiveRouteRow[] {
  const bySlug = new Map<string, LiveRouteRow & { sum: number; timed: number }>();
  for (const v of onARun(vehicles)) {
    const slug = routeSlug(v.routeId);
    const mode = (modeOf.get(v.routeId) ?? "BUS") as LiveMode;
    let row = bySlug.get(slug);
    if (!row) {
      row = {
        slug,
        mode,
        vehicles: 0,
        late: 0,
        onTime: 0,
        early: 0,
        unknown: 0,
        avgDelaySec: null,
        sum: 0,
        timed: 0,
      };
      bySlug.set(slug, row);
    }
    row.vehicles++;
    if (v.delaySec == null || !Number.isFinite(v.delaySec)) {
      row.unknown++;
      continue;
    }
    row.sum += v.delaySec;
    row.timed++;
    const band = delayBand(v.delaySec, mode);
    if (band === "late") row.late++;
    else if (band === "early") row.early++;
    else row.onTime++;
  }
  const rows: LiveRouteRow[] = [...bySlug.values()].map(({ sum, timed, ...row }) => ({
    ...row,
    avgDelaySec: timed > 0 ? sum / timed : null,
  }));
  /**
   * Route-number order, numeric-aware so 9 comes before 100.
   * @param a - One row.
   * @param b - The other.
   * @returns The comparison.
   */
  const byNumber = (a: LiveRouteRow, b: LiveRouteRow): number =>
    a.slug.localeCompare(b.slug, "en", { numeric: true });
  return rows.sort((a, b) =>
    sort === "late"
      ? b.late - a.late || b.vehicles - a.vehicles || byNumber(a, b)
      : b.vehicles - a.vehicles || byNumber(a, b),
  );
}

/** One vehicle as the network map draws it: only what the dot and its popup need. */
export interface LiveMapVehicle {
  id: string;
  label: string | null;
  slug: string;
  mode: LiveMode;
  tripId: string;
  lat: number;
  lon: number;
  delaySec: number | null;
  cars: number | null;
}

/**
 * The network map's vehicles: those on a run, trimmed to the fields the map
 * reads, so a poll of a thousand-odd vehicles stays small.
 * @param vehicles - Every vehicle in the feed.
 * @param modeOf - Route id > mode; a route missing from it counts as a bus.
 * @returns The map's vehicles.
 */
export function mapVehicles(
  vehicles: readonly LiveVehicle[],
  modeOf: ReadonlyMap<string, string>,
): LiveMapVehicle[] {
  return onARun(vehicles).map((v) => ({
    id: v.vehicleId,
    label: v.label,
    slug: routeSlug(v.routeId),
    mode: (modeOf.get(v.routeId) ?? "BUS") as LiveMode,
    tripId: v.tripId as string,
    // Five decimals is about a metre, all a dot on a city map can show.
    lat: Math.round(v.lat * 1e5) / 1e5,
    lon: Math.round(v.lon * 1e5) / 1e5,
    delaySec: v.delaySec,
    cars: v.cars,
  }));
}

/** Network-wide counts over the live rows, for the page's figure strip. */
export interface LiveTotals {
  routes: number;
  vehicles: number;
  late: number;
  onTime: number;
  early: number;
  unknown: number;
}

/**
 * Add up the live rows.
 * @param rows - The rows from {@link liveRoutes}.
 * @returns The totals.
 */
export function liveTotals(rows: readonly LiveRouteRow[]): LiveTotals {
  const t: LiveTotals = {
    routes: rows.length,
    vehicles: 0,
    late: 0,
    onTime: 0,
    early: 0,
    unknown: 0,
  };
  for (const r of rows) {
    t.vehicles += r.vehicles;
    t.late += r.late;
    t.onTime += r.onTime;
    t.early += r.early;
    t.unknown += r.unknown;
  }
  return t;
}
