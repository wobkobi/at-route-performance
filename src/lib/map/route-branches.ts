import { pushTo } from "@/lib/collections";
import { M_PER_DEG } from "@/lib/geo/distance";
// src/lib/map/route-branches.ts
// The paths that draw a whole route on the network map. A route publishes a
// shape per pattern, and no one of them need cover it all: NX1's busiest pattern
// stops at Albany short of Hibiscus Coast, and route 65 splits three ways at its
// western end (Walker Park, Selwyn Village, Coyle Park). So a route draws its
// main shape, then each stretch of its other regular patterns that the paths
// drawn so far do not already cover.

/** Longitude scale at Auckland's latitude. */
const COS_LAT = Math.cos((-36.85 * Math.PI) / 180);

/**
 * The share of the busiest shape's trips a shape needs to be drawn as the main
 * one. The longest such shape wins, since it covers a short-working's road too;
 * the floor keeps a one-trip oddity (a depot run, an Akoranga start) out.
 */
const MAIN_SHARE = 0.25;

/** The share a shape needs for its uncovered stretches to be drawn as branches. */
const BRANCH_SHARE = 0.1;

/**
 * How near a drawn path a point must be to count as covered, in metres. Wide
 * enough for the other direction on a divided road or a one-lane offset between
 * two patterns' shapes, narrow against a parallel street.
 */
const COVER_M = 40;

/** Spacing a branch candidate is read at, in metres. */
const STEP_M = 20;

/** The shortest branch drawn, in metres, so a loop around a terminus block or a bay entry adds nothing. */
const MIN_BRANCH_M = 150;

/** How near the drawn road a branch end must come to stop walking along its shape towards it, in metres. */
const JOIN_M = 1;

/**
 * The furthest a branch end walks along its own shape towards the road it
 * leaves, in metres. A street leaving at 15 degrees takes about 155 m to close
 * the {@link COVER_M} gap; the cap keeps a long parallel approach from being
 * drawn twice.
 */
const JOIN_WALK_M = 200;

/** One of a route's shapes and how many trips follow it. */
export interface RouteShape {
  /** `[lat, lon]` pairs. */
  points: [number, number][];
  trips: number;
}

/**
 * A point in flat metres.
 * @param p - `[lat, lon]`.
 * @returns `[x, y]` in metres.
 */
function metres(p: [number, number]): [number, number] {
  return [p[1] * M_PER_DEG * COS_LAT, p[0] * M_PER_DEG];
}

/**
 * A path's length in metres.
 * @param points - `[lat, lon]` pairs.
 * @returns Its length.
 */
export function pathLength(points: readonly [number, number][]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = metres(points[i - 1] as [number, number]);
    const [bx, by] = metres(points[i] as [number, number]);
    m += Math.hypot(bx - ax, by - ay);
  }
  return m;
}

/**
 * A path with a point at least every {@link STEP_M}, so a gap between a shape's
 * sparse points cannot hide where it leaves the drawn road.
 * @param points - `[lat, lon]` pairs.
 * @returns The densified path, keeping every original point.
 */
function densify(points: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as [number, number];
    const b = points[i + 1] as [number, number];
    const [ax, ay] = metres(a);
    const [bx, by] = metres(b);
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / STEP_M));
    for (let k = 0; k < n; k++) {
      out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
  }
  const last = points.at(-1);
  if (last) out.push(last);
  return out;
}

/**
 * The paths that draw one route: the main shape (the longest carrying at least
 * {@link MAIN_SHARE} of the busiest shape's trips), then, busiest first, every
 * stretch of at least {@link MIN_BRANCH_M} of another shape carrying at least
 * {@link BRANCH_SHARE} that lies beyond {@link COVER_M} of everything drawn so
 * far. Each end of a branch follows its own shape back towards the road it
 * leaves while it gets nearer, then finishes on that road, so it joins the
 * drawn line rather than stopping where it first comes within {@link COVER_M}.
 * The return direction of a branch is covered by the first direction drawn, so
 * each branch draws once.
 * @param shapes - The route's shapes, each with two or more points.
 * @returns The paths, main shape first; empty when no shape has two points.
 */
export function routePaths(shapes: readonly RouteShape[]): [number, number][][] {
  const usable = shapes.filter((s) => s.points.length >= 2);
  if (usable.length === 0) return [];
  const busiest = Math.max(...usable.map((s) => s.trips));
  let main: RouteShape | null = null;
  let mainM = -1;
  for (const s of usable) {
    if (s.trips < busiest * MAIN_SHARE) continue;
    const m = pathLength(s.points);
    if (m > mainM || (m === mainM && main !== null && s.trips > main.trips)) {
      main = s;
      mainM = m;
    }
  }
  if (!main) return [];

  // Covered points on a grid of COVER_M cells; a point reads the nine around its
  // own. The drawn segments sit on the same grid, keyed by their end point, so a
  // branch end can find the nearest spot on the road.
  const grid = new Map<string, [number, number][]>();
  const segments = new Map<string, [number, number, number, number][]>();
  /**
   * Mark a drawn path's points covered and record its segments.
   * @param path - `[lat, lon]` pairs.
   */
  const cover = (path: readonly [number, number][]): void => {
    let prev: [number, number] | null = null;
    for (const p of densify(path)) {
      const [x, y] = metres(p);
      const key = `${Math.floor(x / COVER_M)},${Math.floor(y / COVER_M)}`;
      pushTo(grid, key, [x, y]);
      if (prev) pushTo(segments, key, [prev[0], prev[1], x, y]);
      prev = [x, y];
    }
  };
  /**
   * Whether a point lies within {@link COVER_M} of a drawn path.
   * @param p - `[lat, lon]`.
   * @returns True when covered.
   */
  const covered = (p: [number, number]): boolean => {
    const [x, y] = metres(p);
    const gx = Math.floor(x / COVER_M);
    const gy = Math.floor(y / COVER_M);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [cx, cy] of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (Math.hypot(cx - x, cy - y) <= COVER_M) return true;
        }
      }
    }
    return false;
  };
  /**
   * The nearest spot on a drawn path. Reads two cells each way: a segment is at
   * most {@link STEP_M} long, so one whose nearest spot is within 60 m keeps its
   * end point inside that block.
   * @param p - `[lat, lon]`.
   * @returns The distance in metres and the spot as `[lat, lon]`; Infinity when nothing is that near.
   */
  const nearest = (p: [number, number]): { d: number; at: [number, number] } => {
    const [x, y] = metres(p);
    const gx = Math.floor(x / COVER_M);
    const gy = Math.floor(y / COVER_M);
    let best: { d: number; at: [number, number] } = { d: Infinity, at: p };
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (const [ax, ay, bx, by] of segments.get(`${gx + dx},${gy + dy}`) ?? []) {
          const vx = bx - ax;
          const vy = by - ay;
          const t = Math.min(
            1,
            Math.max(0, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)),
          );
          const cx = ax + t * vx;
          const cy = ay + t * vy;
          const d = Math.hypot(x - cx, y - cy);
          if (d < best.d) best = { d, at: [cy / M_PER_DEG, cx / (M_PER_DEG * COS_LAT)] };
        }
      }
    }
    return best;
  };
  /**
   * Where a branch end meets the drawn road. From the covered point beside the
   * open stretch, step along the shape away from it while each step comes
   * nearer the road (up to {@link JOIN_WALK_M}), so the branch runs into the
   * junction along its own street, then take the road's nearest spot.
   * @param pts - The shape's densified points.
   * @param from - Index of the covered point beside the open stretch.
   * @param step - -1 to walk back from a branch's start, 1 to walk on from its end.
   * @returns The index the walk stopped at and the spot on the road.
   */
  const join = (
    pts: readonly [number, number][],
    from: number,
    step: 1 | -1,
  ): { i: number; at: [number, number] } => {
    let i = from;
    let near = nearest(pts[i] as [number, number]);
    let walked = 0;
    while (near.d > JOIN_M && walked < JOIN_WALK_M) {
      const next = pts[i + step];
      if (!next) break;
      const closer = nearest(next);
      if (closer.d >= near.d) break;
      walked += pathLength([pts[i] as [number, number], next]);
      i += step;
      near = closer;
    }
    return { i, at: near.at };
  };

  const paths: [number, number][][] = [main.points];
  cover(main.points);
  const others = usable
    .filter((s) => s !== main && s.trips >= busiest * BRANCH_SHARE)
    .sort((a, b) => b.trips - a.trips);
  for (const s of others) {
    const pts = densify(s.points);
    const open = pts.map((p) => !covered(p));
    for (let from = 0; from < pts.length;) {
      if (!open[from]) {
        from++;
        continue;
      }
      let to = from;
      while (to + 1 < pts.length && open[to + 1]) to++;
      if (pathLength(pts.slice(from, to + 1)) >= MIN_BRANCH_M) {
        const start = from > 0 ? join(pts, from - 1, -1) : null;
        const end = to + 1 < pts.length ? join(pts, to + 1, 1) : null;
        const branch: [number, number][] = [
          ...(start ? [start.at] : []),
          ...pts.slice(start?.i ?? from, (end?.i ?? to) + 1),
          ...(end ? [end.at] : []),
        ];
        paths.push(branch);
        cover(branch);
      }
      from = to + 1;
    }
  }
  return paths;
}
