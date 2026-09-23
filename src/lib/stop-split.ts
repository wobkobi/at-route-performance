// Folds a route's per-stop arrival sums into figures by direction and by version, so the route
// diagram can print each direction's figure beside each stop and swap in one version's alone.
// Pure and client-safe: the rows come from lib/data/route-stop-split.ts, and the versions from
// the route's strip (lib/route-strip.ts), which groups variants by the names of their ends.

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

/** A route's stop figures over every run, and over each version's runs alone. */
export interface StopSplit {
  all: StopFigures;
  byVersion: Record<string, StopFigures>;
}

/** What placing a run needs of one of a version's variants. */
export interface VersionVariant {
  /** Primary direction id. */
  directionId: number;
  headsign: string | null;
  shapeId: string | null;
  /** Every shape folded into the variant, when others collapsed onto the same stops. */
  shapeIds?: string[];
}

/** What the fold needs of a route: its versions, and its view's direction and stop maps. */
export interface SplitContext {
  /** The route's versions and the variants each is made of. */
  versions: ReadonlyArray<{ key: string; variants: ReadonlyArray<VersionVariant> }>;
  /** A merged direction id > the direction it was folded into. */
  directionIdAliases: Map<number, number>;
  /** Raw stop id > canonical station id. */
  rawToCanon: Map<string, string>;
}

/**
 * The version a run belongs to. Shape first, since a shape is one road: every shape a merged
 * variant was built from counts. A run whose shape matches nothing falls back to its headsign
 * within its direction, and only when that headsign names one version.
 * @param ctx - The route's versions.
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
  const inDir = ctx.versions.flatMap((ver) =>
    ver.variants.filter((v) => v.directionId === dir).map((v) => ({ key: ver.key, v })),
  );
  if (shapeId) {
    const hit = inDir.find(({ v }) => v.shapeId === shapeId || v.shapeIds?.includes(shapeId));
    if (hit) return hit.key;
  }
  if (headsign) {
    const keys = new Set(inDir.filter(({ v }) => v.headsign === headsign).map(({ key }) => key));
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
 * @param ctx - The route's versions and direction and stop maps.
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
