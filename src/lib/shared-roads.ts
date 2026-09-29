// src/lib/shared-roads.ts
// Where routes of different colours share a road, give each colour its own lane
// so the live map can draw them side by side instead of one over the other.
//
// Each path is walked in short steps and every step lands in a grid cell. A cell
// records the colours that pass through it, so a step's lane is its colour's rank
// among the colours in the cells around it. Lanes are counted in line widths
// either side of the road's centre ("slots"); the map turns them into pixels at
// its current zoom, so the spacing holds however far in the reader is.
//
// Routes of one colour share a lane and overlap, which is the point: forty
// Shore-blue buses down one road read as one blue road, not forty lines.
//
// Before any of that, a path running the other way beside an earlier one is
// pulled onto it. Each route is drawn along one direction, and a divided road
// keeps its directions apart: the Harbour Bridge's two carriageways sit 45 m
// apart, too far for the grid to call them one road, so every colour on it drew
// twice, once per carriageway.

import { simplifyPath } from "@/lib/route-geo";

/** Metres per degree of latitude, the same flat approximation route-geo uses. */
const M_PER_DEG = 111_320;

/** The walking step along a path, in metres: fine enough that no road is skipped. */
const STEP_M = 15;

/**
 * Grid cell size in metres. A step also reads the eight cells around its own, so
 * two routes on one road count as sharing it even when their shapes sit a few
 * metres apart across a cell edge. That reach (up to about two cells) is less
 * than the gap between most parallel roads.
 */
const CELL_M = 12;

/**
 * The shortest stretch a lane change may last, in steps (60 m). A cross street
 * puts its colours in a couple of cells at an intersection, and a route passing
 * through would otherwise jog aside for 30 m and back.
 */
const MIN_RUN_STEPS = 4;

/**
 * Farthest a path is pulled onto an earlier one running the other way, in
 * metres: wide enough for a motorway's two carriageways, narrow against the
 * 80 m and up between most parallel streets.
 */
const SNAP_M = 50;

/**
 * The shortest stretch pulled across, in steps (90 m), so a route passing an
 * opposite one where a cross street meets it stays where it is.
 */
const MIN_SNAP_STEPS = 6;

/**
 * Largest change in the pull between one step and the next that still counts as
 * one stretch, in metres. Along one carriageway the pull holds steady, give or
 * take the 15 m between anchors; at a junction like Akoranga, where the busway,
 * the motorway and its ramps all sit within reach, the nearest anchor flips
 * between roads and the pulled line would zigzag across them.
 */
const SNAP_JUMP_M = 20;

/**
 * Two headings count as one road's two directions when they are within 25
 * degrees of opposite: the dot product of their unit vectors is below this.
 */
const OPPOSED_DOT = -Math.cos((25 * Math.PI) / 180);

/** One route's path as the lanes are worked out over it. */
export interface LaneInput {
  /** The colour lanes are shared by: routes of one colour ride one lane. */
  colour: string;
  /**
   * Paths only pull onto others of the same mode, so a bus road beside a rail
   * line stays beside it. Paths without one pull onto each other.
   */
  mode?: string;
  /** The path as `[lat, lon]` pairs, at full detail. */
  points: [number, number][];
}

/** A stretch of one route drawn at one lane. */
export interface LaneRun {
  /**
   * Lanes from the road's centre, in line widths, to the left of the route's
   * direction of travel (negative: the right). 0 when no other colour is near.
   */
  slot: number;
  /** The stretch as `[lat, lon]` pairs, thinned to the given tolerance. */
  points: [number, number][];
}

/** One step along a path: its place on the grid and its direction. */
interface Step {
  lat: number;
  lon: number;
  cx: number;
  cy: number;
  /** Unit direction of travel, east and north. */
  ux: number;
  uy: number;
}

/** What one grid cell has seen. */
interface Cell {
  colours: Set<string>;
  /**
   * The direction of the first path through the cell. Lanes are placed against
   * it, so two routes on one road agree on which side is left even when they
   * travel it in opposite directions. The first path through a road usually
   * runs its whole length, so the cells along it share one reference.
   */
  rx: number;
  ry: number;
}

/**
 * Walk a path in {@link STEP_M} steps, keeping each step's grid cell and heading.
 * @param points - The path as `[lat, lon]` pairs.
 * @param cosLat - Longitude scale at the network's latitude.
 * @returns The steps, the first at the path's start.
 */
function walk(points: [number, number][], cosLat: number): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const dx = (b[1] - a[1]) * M_PER_DEG * cosLat;
    const dy = (b[0] - a[0]) * M_PER_DEG;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const ux = dx / len;
    const uy = dy / len;
    // Both ends of the path are always stepped on, so the runs cover all of it.
    const count = Math.max(1, Math.ceil(len / STEP_M));
    const last = i + 2 === points.length;
    for (let k = 0; k < count + (last ? 1 : 0); k++) {
      const t = k / count;
      const lat = a[0] + (b[0] - a[0]) * t;
      const lon = a[1] + (b[1] - a[1]) * t;
      steps.push({
        lat,
        lon,
        cx: Math.floor((lon * M_PER_DEG * cosLat) / CELL_M),
        cy: Math.floor((lat * M_PER_DEG) / CELL_M),
        ux,
        uy,
      });
    }
  }
  return steps;
}

/**
 * Collapse a slot per step into runs, folding any run shorter than
 * {@link MIN_RUN_STEPS} into the one before it (or after it, at the start).
 * @param slots - One slot per step.
 * @returns Runs as `[firstStep, lastStep, slot]`, in order, covering every step.
 */
function toRuns(slots: number[]): [number, number, number][] {
  const smoothed = [...slots];
  let changed = true;
  // Repeated because folding one short run can join two neighbours into one
  // that is long enough, or leave a shorter one beside it.
  while (changed) {
    changed = false;
    const runs = collapse(smoothed);
    if (runs.length < 2) break;
    for (let r = 0; r < runs.length; r++) {
      const [from, to] = runs[r] as [number, number, number];
      if (to - from + 1 >= MIN_RUN_STEPS) continue;
      const donor = runs[r === 0 ? 1 : r - 1] as [number, number, number];
      for (let s = from; s <= to; s++) smoothed[s] = donor[2];
      changed = true;
      break;
    }
  }
  return collapse(smoothed);
}

/**
 * Consecutive equal slots as runs.
 * @param slots - One slot per step.
 * @returns Runs as `[firstStep, lastStep, slot]`.
 */
function collapse(slots: number[]): [number, number, number][] {
  const runs: [number, number, number][] = [];
  for (let s = 0; s < slots.length; s++) {
    const slot = slots[s] as number;
    const open = runs[runs.length - 1];
    if (open && open[2] === slot) open[1] = s;
    else runs.push([s, s, slot]);
  }
  return runs;
}

/** A step of an earlier path that a later one may be pulled onto. */
interface Anchor {
  lat: number;
  lon: number;
  ux: number;
  uy: number;
  mode: string | undefined;
}

/**
 * Pull each path's steps onto an earlier path running the other way within
 * {@link SNAP_M}, in place. Paths are taken in order and each one's own steps
 * then join the anchors, so the first path along a divided road is the line
 * both its directions draw on. A pull only holds over {@link MIN_SNAP_STEPS} in
 * a row; a shorter one is a crossing, not a shared road.
 *
 * Anchors sit on a {@link SNAP_M} grid, and a step reads the nine cells around
 * its own, which covers every anchor within reach. Steps landing in a lane cell
 * already holding a step of the same heading add nothing, so forty routes down
 * one road leave one road's worth of anchors.
 * @param lines - The paths, for their modes.
 * @param walks - Each path's steps, moved in place.
 * @param cosLat - Longitude scale at the network's latitude.
 */
function snapOpposed(lines: readonly LaneInput[], walks: Step[][], cosLat: number): void {
  const anchors = new Map<string, Anchor[]>();
  const seen = new Set<string>();
  /**
   * A point's cell on the anchor grid.
   * @param lat - Latitude.
   * @param lon - Longitude.
   * @returns The cell's column and row.
   */
  const snapCell = (lat: number, lon: number): [number, number] => [
    Math.floor((lon * M_PER_DEG * cosLat) / SNAP_M),
    Math.floor((lat * M_PER_DEG) / SNAP_M),
  ];
  lines.forEach((line, i) => {
    const steps = walks[i] ?? [];
    const targets = steps.map((s): Anchor | null => {
      const [gx, gy] = snapCell(s.lat, s.lon);
      let best: Anchor | null = null;
      let bestM = SNAP_M;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const a of anchors.get(`${gx + dx},${gy + dy}`) ?? []) {
            if (a.mode !== line.mode || a.ux * s.ux + a.uy * s.uy > OPPOSED_DOT) continue;
            const m = Math.hypot((a.lon - s.lon) * M_PER_DEG * cosLat, (a.lat - s.lat) * M_PER_DEG);
            if (m <= bestM) {
              best = a;
              bestM = m;
            }
          }
        }
      }
      return best;
    });
    /**
     * Whether steps k and k + 1 are pulled by about the same amount, so they sit
     * in one stretch rather than on two different roads.
     * @param k - The first step's index.
     * @returns True when the pull holds steady across the pair.
     */
    const steady = (k: number): boolean => {
      const a = targets[k],
        b = targets[k + 1],
        sa = steps[k],
        sb = steps[k + 1];
      if (!a || !b || !sa || !sb) return false;
      const dLat = b.lat - sb.lat - (a.lat - sa.lat);
      const dLon = b.lon - sb.lon - (a.lon - sa.lon);
      return Math.hypot(dLon * M_PER_DEG * cosLat, dLat * M_PER_DEG) <= SNAP_JUMP_M;
    };
    // Drop pulls shorter than the minimum run, a jump in the pull ending a run.
    for (let from = 0; from < targets.length;) {
      if (!targets[from]) {
        from++;
        continue;
      }
      let to = from;
      while (to + 1 < targets.length && steady(to)) to++;
      if (to - from + 1 < MIN_SNAP_STEPS) targets.fill(null, from, to + 1);
      from = to + 1;
    }
    steps.forEach((s, k) => {
      const t = targets[k];
      if (t) {
        // Moved onto the anchor, keeping its own heading so the lanes still
        // know it travels the road the other way.
        s.lat = t.lat;
        s.lon = t.lon;
        s.cx = Math.floor((t.lon * M_PER_DEG * cosLat) / CELL_M);
        s.cy = Math.floor((t.lat * M_PER_DEG) / CELL_M);
        return;
      }
      // Eight heading buckets, so a road's two directions both anchor.
      const heading = Math.round(((Math.atan2(s.uy, s.ux) + Math.PI) / (2 * Math.PI)) * 8) % 8;
      const key = `${s.cx},${s.cy},${heading},${line.mode ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      const [gx, gy] = snapCell(s.lat, s.lon);
      const cell = `${gx},${gy}`;
      const anchor: Anchor = { lat: s.lat, lon: s.lon, ux: s.ux, uy: s.uy, mode: line.mode };
      const list = anchors.get(cell);
      if (list) list.push(anchor);
      else anchors.set(cell, [anchor]);
    });
  });
}

/**
 * Split every path into stretches, each with the lane its colour takes there.
 * Paths are read in the order given, and the first through a road sets which
 * side of it is left and, on a divided road, which carriageway both directions
 * draw on (see {@link snapOpposed}), so a stable order gives a stable picture.
 * @param lines - The routes' paths and colours.
 * @param tolerance - How far a thinned stretch may stray from its path, in metres.
 * @returns For each input, in order, its runs; a path under two points gets none.
 */
export function laneRuns(lines: readonly LaneInput[], tolerance: number): LaneRun[][] {
  const first = lines.find((l) => l.points.length > 0)?.points[0];
  const cosLat = Math.cos(((first?.[0] ?? 0) * Math.PI) / 180) || 1e-6;
  const walks = lines.map((l) => walk(l.points, cosLat));
  snapOpposed(lines, walks, cosLat);

  const cells = new Map<string, Cell>();
  lines.forEach((line, i) => {
    for (const s of walks[i] ?? []) {
      const key = `${s.cx},${s.cy}`;
      const cell = cells.get(key);
      if (cell) cell.colours.add(line.colour);
      else cells.set(key, { colours: new Set([line.colour]), rx: s.ux, ry: s.uy });
    }
  });

  return lines.map((line, i) => {
    const steps = walks[i] ?? [];
    if (steps.length < 2) return [];
    const slots = steps.map((s) => {
      const near = new Set<string>();
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const c of cells.get(`${s.cx + dx},${s.cy + dy}`)?.colours ?? []) near.add(c);
        }
      }
      if (near.size < 2) return 0;
      // A fixed order, so every route on the road ranks the colours alike.
      const order = [...near].sort();
      const lane = order.indexOf(line.colour) - (order.length - 1) / 2;
      const own = cells.get(`${s.cx},${s.cy}`);
      // Against the road's reference direction: travelling it the other way
      // flips left and right, so the lane flips with it to stay on its side.
      const facing = own && own.rx * s.ux + own.ry * s.uy < 0 ? -1 : 1;
      return lane * facing;
    });
    return toRuns(slots).map(([from, to, slot]) => {
      // Each stretch runs on to the next one's first step, so the two meet.
      const end = Math.min(to + 1, steps.length - 1);
      const pts = steps.slice(from, end + 1).map((s): [number, number] => [s.lat, s.lon]);
      return { slot, points: simplifyPath(pts, tolerance) };
    });
  });
}

/**
 * Shift a polyline sideways in screen space, each point along the average of
 * its two segments' normals, so a lane keeps its distance from the road through
 * a bend. Screen coordinates run right and down, so the left of travel is the
 * normal `(dy, -dx)`.
 * @param points - The polyline as `[x, y]` pixels.
 * @param distance - Pixels to the left of travel (negative: the right).
 * @returns The shifted polyline; the input itself when the distance is 0.
 */
export function shiftPixels(points: [number, number][], distance: number): [number, number][] {
  if (distance === 0 || points.length < 2) return points;
  const normals = points.slice(0, -1).map((a, i): [number, number] => {
    const b = points[i + 1] as [number, number];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [dy / len, -dx / len];
  });
  return points.map(([x, y], i) => {
    const before = normals[i - 1];
    const after = normals[i];
    const n = before && after ? [before[0] + after[0], before[1] + after[1]] : (before ?? after);
    const [nx, ny] = n as [number, number];
    const len = Math.hypot(nx, ny);
    // A path doubling straight back has opposing normals; keep the point in place.
    if (len < 1e-6) return [x, y];
    return [x + (nx / len) * distance, y + (ny / len) * distance];
  });
}
