// src/lib/operator-stats.ts
// Operator figures folded from the per-route rows the Routes page already
// reads, so an operator's punctuality costs no query of its own: each route's
// figures are weighted by its arrivals, as a multi-day route row is built from
// its days.
import { MODES } from "@/lib/mode";
import { type Operator, operatorOf } from "@/lib/operators";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { routeSlug } from "@/lib/route/slug";
import type { VehicleTotal } from "@/lib/vehicle/rank";
import type { TopRouteRow } from "@/types/api";

/** One operator's figures over a window. */
export interface OperatorRow {
  operator: Operator;
  /** Routes with at least one arrival or cancellation. */
  routes: number;
  events: number;
  on_time_pct: number | null;
  avg_abs_delay_sec: number | null;
  avg_delay_sec: number | null;
  early_pct: number | null;
  late_pct: number | null;
  /** Trips cancelled across its routes. */
  cancelled: number;
  /** Vehicles that ran any of its routes, when the fleet was counted. */
  vehicles: number | null;
  /** The modes its routes run, in BUS, TRAIN, FERRY order. */
  modes: string[];
}

/** The per-route figures an operator's are weighted from. */
const WEIGHTED = [
  "on_time_pct",
  "avg_abs_delay_sec",
  "avg_delay_sec",
  "early_pct",
  "late_pct",
] as const;

/**
 * The operator code behind a route row. The lookup is by slug, since a row may
 * carry any feed version of its route.
 * @param routeId - The row's route id (versioned or already a slug).
 * @param operators - Route slug > agency code.
 * @returns The code, or undefined for a route with none recorded.
 */
export function operatorCodeOf(
  routeId: string,
  operators: Record<string, string>,
): string | undefined {
  return operators[routeSlug(routeId)];
}

/**
 * Every operator's figures over a window, best on-time share first. An operator
 * whose routes recorded fewer than {@link MIN_BOARD_EVENTS} arrivals sorts
 * after the rest, since one quiet ferry would otherwise top or tail the table
 * on a handful of arrivals.
 * @param rows - Per-route rows for the window (a route can appear once per feed version).
 * @param operators - Route slug > agency code.
 * @param cancelledBySlug - Route slug > trips cancelled in the window.
 * @param vehicles - Vehicle totals for the window, or null to leave the fleet uncounted.
 * @param directory - The stored operator list, which names each code.
 * @returns One row per operator with at least one route in the window.
 */
export function operatorRows(
  rows: readonly TopRouteRow[],
  operators: Record<string, string>,
  cancelledBySlug: ReadonlyMap<string, number> = new Map(),
  vehicles: readonly VehicleTotal[] | null = null,
  directory: readonly Operator[] = [],
): OperatorRow[] {
  interface Acc {
    slugs: Set<string>;
    modes: Set<string>;
    events: number;
    sums: Record<(typeof WEIGHTED)[number], number>;
    weights: Record<(typeof WEIGHTED)[number], number>;
    cancelled: number;
    vehicles: number;
  }
  const acc = new Map<string, Acc>();
  /**
   * The accumulator for one operator, created on first use.
   * @param code - Agency code.
   * @returns Its accumulator.
   */
  const get = (code: string): Acc => {
    let a = acc.get(code);
    if (!a) {
      const zero = Object.fromEntries(WEIGHTED.map((k) => [k, 0])) as Acc["sums"];
      a = {
        slugs: new Set(),
        modes: new Set(),
        events: 0,
        sums: { ...zero },
        weights: { ...zero },
        cancelled: 0,
        vehicles: 0,
      };
      acc.set(code, a);
    }
    return a;
  };

  for (const r of rows) {
    const code = operatorCodeOf(r.route_id, operators);
    if (!code) continue;
    const a = get(code);
    a.slugs.add(routeSlug(r.route_id));
    a.modes.add(r.mode);
    a.events += r.events;
    for (const k of WEIGHTED) {
      const v = r[k];
      if (v === null || v === undefined || r.events === 0) continue;
      a.sums[k] += v * r.events;
      a.weights[k] += r.events;
    }
  }
  for (const [slug, n] of cancelledBySlug) {
    const code = operators[slug];
    if (!code) continue;
    const a = get(code);
    a.slugs.add(slug);
    a.cancelled += n;
  }
  if (vehicles) {
    for (const v of vehicles) {
      for (const code of vehicleOperatorCodes(v, operators)) get(code).vehicles += 1;
    }
  }

  const out: OperatorRow[] = [];
  for (const [code, a] of acc) {
    const op = operatorOf(code, directory)!;
    /**
     * One weighted figure, to one decimal place.
     * @param k - The figure.
     * @returns Its arrival-weighted mean, or null when no route carried it.
     */
    const avg = (k: (typeof WEIGHTED)[number]): number | null =>
      a.weights[k] > 0 ? Math.round((a.sums[k] / a.weights[k]) * 10) / 10 : null;
    out.push({
      operator: op,
      routes: a.slugs.size,
      events: a.events,
      on_time_pct: avg("on_time_pct"),
      avg_abs_delay_sec: avg("avg_abs_delay_sec"),
      avg_delay_sec: avg("avg_delay_sec"),
      early_pct: avg("early_pct"),
      late_pct: avg("late_pct"),
      cancelled: a.cancelled,
      vehicles: vehicles ? a.vehicles : null,
      modes: MODES.filter((m) => a.modes.has(m)),
    });
  }
  return out.sort(
    (x, y) =>
      Number(y.events >= MIN_BOARD_EVENTS) - Number(x.events >= MIN_BOARD_EVENTS) ||
      (y.on_time_pct ?? -1) - (x.on_time_pct ?? -1) ||
      y.events - x.events,
  );
}

/**
 * The operators whose routes a vehicle ran. Almost always one; a bus lent to a
 * rail replacement can carry two.
 * @param v - The vehicle's total.
 * @param operators - Route slug > agency code.
 * @returns Distinct agency codes, in the order its routes list them.
 */
export function vehicleOperatorCodes(
  v: Pick<VehicleTotal, "routes">,
  operators: Record<string, string>,
): string[] {
  const codes = new Set<string>();
  for (const id of v.routes) {
    const code = operatorCodeOf(id, operators);
    if (code) codes.add(code);
  }
  return [...codes];
}
