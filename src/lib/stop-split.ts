// Folds a route's per-stop arrival sums into figures by direction and by version, so the route
// diagram can print each direction's figure beside each stop and swap in one version's alone.
// Pure and client-safe: the rows come from lib/data/route-stop-split.ts.
import type { RouteVariant } from "@/types/api";

/** Arrival sums for one stop, from the runs of one direction, shape and headsign. */
export interface StopSplitRow {
  stop_id: string;
  direction_id: number | null;
  shape_id: string | null;
  headsign: string | null;
  events: number;
  /** Sum of the signed deviation over those arrivals, in seconds. */
  dev_sum: number;
  /** How many of those arrivals fell inside the route's on-time window. */
  on_time: number;
}

/** One stop's figure for one direction. */
export interface StopFigure {
  events: number;
  avg_delay_sec: number;
  on_time_pct: number;
}

/** Figures by canonical stop id, then by primary direction id. */
export type StopFigures = Record<string, Record<number, StopFigure>>;

/**
 * A version of a route: every variant, in either direction, that runs between the same two
 * termini. On 65 that is Coyle Park to Glen Innes and back, which is one version.
 */
export interface RouteVersion {
  key: string;
  /** Canonical stop id the version starts from, read off its lowest direction. */
  from: string;
  to: string;
  tripCount: number;
}

/** A route's stop figures over every run, and over each version's runs alone. */
export interface StopSplit {
  all: StopFigures;
  byVersion: Record<string, StopFigures>;
}

/** The pieces of a route view the fold needs. */
export interface SplitContext {
  directions: Record<number, { variants: RouteVariant[] }>;
  /** A merged direction id > the direction it was folded into. */
  directionIdAliases: Map<number, number>;
  /** Raw stop id > canonical station id. */
  rawToCanon: Map<string, string>;
}

/**
 * A variant's version key: its two termini in a fixed order, so the run out and the run back
 * share one key.
 * @param v - The variant.
 * @returns The key, empty for a variant with no stops.
 */
export function versionKey(v: RouteVariant): string {
  const first = v.stopIds[0];
  const last = v.stopIds.at(-1);
  if (first === undefined || last === undefined) return "";
  return [first, last].sort().join("|");
}

/**
 * Every version of a route, busiest first. A route with one pair of termini has one version.
 * @param directions - The route's merged directions.
 * @returns The versions.
 */
export function routeVersions(
  directions: Record<number, { variants: RouteVariant[] }>,
): RouteVersion[] {
  const out = new Map<string, RouteVersion>();
  const dirs = Object.keys(directions)
    .map(Number)
    .sort((a, b) => a - b);
  for (const d of dirs) {
    for (const v of directions[d]?.variants ?? []) {
      const key = versionKey(v);
      if (!key) continue;
      const cur = out.get(key);
      // The lowest direction is read first, so its variant names the start.
      if (cur) cur.tripCount += v.tripCount;
      else
        out.set(key, { key, from: v.stopIds[0]!, to: v.stopIds.at(-1)!, tripCount: v.tripCount });
    }
  }
  return [...out.values()].sort((a, b) => b.tripCount - a.tripCount);
}

/**
 * The version a run belongs to. Shape first, since a shape is one road: every shape a merged
 * variant was built from counts. A run whose shape matches nothing falls back to its headsign
 * within its direction, and only when that headsign names one version.
 * @param ctx - The route view.
 * @param dir - The run's primary direction id.
 * @param shapeId - The run's shape id.
 * @param headsign - The run's headsign.
 * @returns The version key, or null when the run cannot be placed.
 */
function versionOfRun(
  ctx: SplitContext,
  dir: number,
  shapeId: string | null,
  headsign: string | null,
): string | null {
  const variants = ctx.directions[dir]?.variants ?? [];
  if (shapeId) {
    const v = variants.find((x) => x.shapeId === shapeId || x.shapeIds?.includes(shapeId));
    if (v) return versionKey(v);
  }
  if (headsign) {
    const keys = new Set(variants.filter((x) => x.headsign === headsign).map(versionKey));
    if (keys.size === 1) return [...keys][0]!;
  }
  return null;
}

/** Running sums for one stop and direction. */
interface Acc {
  events: number;
  dev: number;
  onTime: number;
}

/**
 * Add a row's sums into a figure table.
 * @param table - Sums by stop, then direction.
 * @param stop - Canonical stop id.
 * @param dir - Primary direction id.
 * @param r - The row.
 */
function add(
  table: Map<string, Map<number, Acc>>,
  stop: string,
  dir: number,
  r: StopSplitRow,
): void {
  let byDir = table.get(stop);
  if (!byDir) table.set(stop, (byDir = new Map()));
  const acc = byDir.get(dir) ?? { events: 0, dev: 0, onTime: 0 };
  acc.events += r.events;
  acc.dev += r.dev_sum;
  acc.onTime += r.on_time;
  byDir.set(dir, acc);
}

/**
 * Turn running sums into figures, averaged over arrivals (never over days or runs, so a busy
 * stretch weighs what it carried).
 * @param table - Sums by stop, then direction.
 * @returns The figures, rounded to a tenth.
 */
function finish(table: Map<string, Map<number, Acc>>): StopFigures {
  const out: StopFigures = {};
  for (const [stop, byDir] of table) {
    const row: Record<number, StopFigure> = {};
    for (const [dir, a] of byDir) {
      if (a.events === 0) continue;
      row[dir] = {
        events: a.events,
        avg_delay_sec: Math.round((a.dev / a.events) * 10) / 10,
        on_time_pct: Math.round((a.onTime / a.events) * 1000) / 10,
      };
    }
    out[stop] = row;
  }
  return out;
}

/**
 * Fold per-stop rows into figures by direction and by version. Train platforms and busway poles
 * collapse onto their canonical station through the view's own map, so the figures key the same
 * stops the diagram draws. A row with no direction (its run has no trip record) is left out,
 * since there is no column to put it in.
 * @param rows - Arrival sums by stop, direction, shape and headsign.
 * @param ctx - The route view the figures are for.
 * @returns Figures over every run, and over each version's runs.
 */
export function splitStopFigures(rows: StopSplitRow[], ctx: SplitContext): StopSplit {
  const all = new Map<string, Map<number, Acc>>();
  const byVersion = new Map<string, Map<string, Map<number, Acc>>>();
  for (const r of rows) {
    if (r.direction_id == null) continue;
    const dir = ctx.directionIdAliases.get(r.direction_id) ?? r.direction_id;
    const stop = ctx.rawToCanon.get(r.stop_id) ?? r.stop_id;
    add(all, stop, dir, r);
    const key = versionOfRun(ctx, dir, r.shape_id, r.headsign);
    if (key == null) continue;
    let table = byVersion.get(key);
    if (!table) byVersion.set(key, (table = new Map()));
    add(table, stop, dir, r);
  }
  return {
    all: finish(all),
    byVersion: Object.fromEntries([...byVersion].map(([k, t]) => [k, finish(t)])),
  };
}
