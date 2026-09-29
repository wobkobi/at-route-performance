// src/lib/route-branches.ts
// The paths that draw a whole route on the network map. A route publishes a
// shape per pattern, and no one of them need cover it all: NX1's busiest pattern
// stops at Albany short of Hibiscus Coast, and route 65 splits three ways at its
// western end (Walker Park, Selwyn Village, Coyle Park). So a route draws its
// main shape, then each stretch of its other regular patterns that the paths
// drawn so far do not already cover.

/** Metres per degree of latitude, the flat approximation the lanes use. */
const M_PER_DEG = 111_320;

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
 * far. A branch keeps one point either side of its stretch, so it meets the
 * road it leaves. The return direction of a branch is covered by the first
 * direction drawn, so each branch draws once.
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

  // Covered points on a grid of COVER_M cells; a point reads the nine around its own.
  const grid = new Map<string, [number, number][]>();
  /**
   * Mark a drawn path's points covered.
   * @param path - `[lat, lon]` pairs.
   */
  const cover = (path: readonly [number, number][]): void => {
    for (const p of densify(path)) {
      const [x, y] = metres(p);
      const key = `${Math.floor(x / COVER_M)},${Math.floor(y / COVER_M)}`;
      const cell = grid.get(key);
      if (cell) cell.push([x, y]);
      else grid.set(key, [[x, y]]);
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
        const branch = pts.slice(Math.max(0, from - 1), Math.min(pts.length, to + 2));
        paths.push(branch);
        cover(branch);
      }
      from = to + 1;
    }
  }
  return paths;
}
