// src/lib/route-graph.ts
/**
 * @description Lays out a route's stops as a metro-style diagram in pixel
 * coordinates: nodes, edges, and label sides. The main line is the busiest
 * variant, snake-wrapped (boustrophedon) so it stays within card width; other
 * variants fork off as branches where they share an origin or a destination, with
 * branch lanes stacked in the widened gaps between trunk rows and label sides
 * alternated so text never lands on a line. Triangle and closed-loop shapes get
 * their own dedicated layouts. The geometry choices (45deg connectors, parallel
 * up/down lanes that cannot cross, outer-side labels) all exist to keep a dense
 * diagram readable without overlaps.
 */
import type { RouteVariant } from "@/types/api";

/** Which side of its line a stop's time label sits on (away from the line). */
export type LabelDir = "up" | "down" | "left" | "right";

/** A stop placed on the diagram, in pixels (`branch` 0 = trunk). */
export interface DiagramNode {
  stopId: string;
  cx: number;
  cy: number;
  branch: number;
  /** Side to place this stop's time label, so it never sits on a line. */
  labelDir: LabelDir;
}

/** A segment between two placed stops, in pixels. */
export interface DiagramEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** True for a branch segment (drawn muted/thinner); false for the trunk. */
  branch: boolean;
}

/** A branch's headsign label, at the branch's last stop (pixels). */
export interface BranchLabel {
  headsign: string | null;
  cx: number;
  cy: number;
  /** True when the branch runs leftward, so the label sits to the left. */
  toLeft?: boolean;
  /** True when the branch is convergent (upward), so the end-label nudges upward. */
  toUp?: boolean;
}

/** A laid-out trunk + branches diagram (pixel coordinates). */
export interface BranchedSnake {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  labels: BranchLabel[];
  width: number;
  height: number;
  /** Variants that share no origin with the trunk; drawn as their own lines. */
  separate: RouteVariant[];
  /** Headsign of the variant drawn as the trunk (the spine), for the heading. */
  trunkHeadsign: string | null;
  /** True when the trunk is a closed loop (the line returns to its start). */
  closed?: boolean;
}

/** Layout geometry for {@link buildBranchedSnake}. */
export interface SnakeOpts {
  /** Trunk stops per row before the snake wraps. */
  cols: number;
  /** Px between trunk columns. */
  col: number;
  /** Px between trunk rows. */
  row: number;
  /** Px padding left/right and top. */
  padX: number;
  padTop: number;
  /** Px padding bottom. */
  padBottom: number;
  /**
   * Px a branch lane sits above/below its divergence row. Also the run of the
   * 45deg connector that leaves the trunk before the branch goes horizontal.
   */
  branchDrop: number;
  /** Max divergent stops drawn per branch (default 6). */
  maxBranchStops?: number;
  /** Minimum divergent stops for a variant to fork (smaller is ignored; default 3). */
  minBranchStops?: number;
  /** Px reserved on the right for a branch end label (default 0). */
  labelReserve?: number;
  /** Px reserved on the right for the angled delay labels (default 0). */
  rightPad?: number;
}

/**
 * Detect a triangle pattern: exactly two variants that share the same first and
 * last stop but one is a direct 2-stop run and the other detours via intermediate
 * stops. Returns [direct, via] when matched, null otherwise.
 * @param variants - Variants for one direction.
 * @returns The direct and via variants, or null.
 */
export function detectTriangle(variants: RouteVariant[]): [RouteVariant, RouteVariant] | null {
  if (variants.length !== 2) return null;
  const [a, b] = variants;
  const direct = a.stopIds.length <= b.stopIds.length ? a : b;
  const via = direct === a ? b : a;
  if (direct.stopIds.length !== 2 || via.stopIds.length < 3) return null;
  if (direct.stopIds[0] !== via.stopIds[0]) return null;
  if (direct.stopIds[1] !== via.stopIds.at(-1)) return null;
  return [direct, via];
}

/**
 * Lay out a triangle route: a direct 2-stop variant and a detour variant sharing
 * the same terminal stops. Terminals sit at the base (left and right); the
 * detour's intermediate stops sit at the apex. The direct connection is drawn as
 * the horizontal base edge (trunk weight); the detour legs are the two angled
 * sides (branch weight).
 * @param direct - Direct variant (2 stops).
 * @param via - Detour variant (same first/last stop, with intermediate stops).
 * @param opts - Layout geometry.
 * @returns Triangle layout.
 */
export function buildTriangle(
  direct: RouteVariant,
  via: RouteVariant,
  opts: SnakeOpts,
): BranchedSnake {
  const { padX, padTop, padBottom } = opts;
  const rightPad = opts.rightPad ?? 0;

  const A = via.stopIds[0];
  const C = via.stopIds[via.stopIds.length - 1];
  const middle = via.stopIds.slice(1, -1);
  const spans = middle.length + 1;

  const baseY = padTop + opts.row;
  const apexY = padTop;
  const cxA = padX;
  // Use row as the horizontal step so each leg runs at 45 degrees (dx === dy).
  const legRun = opts.row;
  const cxC = padX + spans * legRun;

  const nodes: DiagramNode[] = [
    { stopId: A, cx: cxA, cy: baseY, branch: 0, labelDir: "down" },
    ...middle.map((id, i) => ({
      stopId: id,
      cx: padX + (i + 1) * legRun,
      cy: apexY,
      branch: 0 as const,
      labelDir: "up" as LabelDir,
    })),
    { stopId: C, cx: cxC, cy: baseY, branch: 0, labelDir: "down" },
  ];

  // closed: true tells DiagramSvg to add the first node to the end of the trunk
  // polyline (A > middle > C > A), closing the triangle at uniform trunk weight.
  // No separate edges needed.
  return {
    nodes,
    edges: [],
    labels: [],
    width: cxC + padX + rightPad,
    height: baseY + padBottom,
    separate: [],
    trunkHeadsign: direct.headsign ?? via.headsign,
    closed: true,
  };
}

/**
 * Whether a variant returns to where it started (its first and last stop are the
 * same), so it should be drawn as a closed loop rather than an open line.
 * @param variant - A stopping pattern.
 * @returns True when the first and last stop ids match and there are 3+ stops.
 */
export function isLoopVariant(variant: RouteVariant): boolean {
  const ids = variant.stopIds;
  return ids.length > 2 && ids[0] === ids[ids.length - 1];
}

/**
 * Lay a loop variant out as a closed box: the outbound half along the top edge
 * (left>right), the return half along the bottom (right>left), joined down the
 * right side and closed up the left. No branches - a loop is one circuit.
 * @param variant - A loop variant (see {@link isLoopVariant}).
 * @param opts - Layout geometry (uses col/row/padding).
 * @returns Placed nodes forming a closed loop, flagged `closed`.
 */
export function buildBoxLoop(variant: RouteVariant, opts: SnakeOpts): BranchedSnake {
  const { col, row, padX, padTop, padBottom } = opts;
  const rightPad = opts.rightPad ?? 0;
  const ids = variant.stopIds;
  // Drop the duplicate closing stop; the loop returns to ring[0].
  const ring = ids[0] === ids[ids.length - 1] ? ids.slice(0, -1) : ids;
  const n = ring.length;
  const top = Math.ceil(n / 2);
  const bottomCount = n - top;
  // Wide columns so each edge's labels (all on the outer side) clear one another.
  const loopCol = Math.max(col, 92);
  const rightX = padX + (top - 1) * loopCol;

  const nodes: DiagramNode[] = [];
  // Top edge: outbound, left to right; every label above (outer side, clear of the
  // box interior and the vertical sides).
  for (let i = 0; i < top; i++) {
    nodes.push({ stopId: ring[i], cx: padX + i * loopCol, cy: padTop, branch: 0, labelDir: "up" });
  }
  // Bottom edge: return, right to left, ending under the top-left so the loop
  // closes on a clean vertical (not a diagonal); every label below (outer side).
  const bottomStep = bottomCount > 1 ? (rightX - padX) / (bottomCount - 1) : 0;
  for (let j = 0; j < bottomCount; j++) {
    const cx = bottomCount > 1 ? rightX - j * bottomStep : padX;
    nodes.push({ stopId: ring[top + j], cx, cy: padTop + row, branch: 0, labelDir: "down" });
  }

  return {
    nodes,
    edges: [],
    labels: [],
    width: rightX + padX + rightPad,
    height: padTop + row + padBottom,
    separate: [],
    trunkHeadsign: variant.headsign,
    closed: true,
  };
}

/**
 * Lay a direction's variants out as a metro-style trunk with branches. The
 * busiest (then longest) variant is the **trunk**, snake-wrapped (boustrophedon)
 * so it stays on-screen. Every other variant is aligned to the trunk by its
 * longest shared run at either end: a variant that shares the **origin** forks
 * its divergent **tail** off where it splits; a variant that shares the
 * **destination** but starts elsewhere (e.g. several start points all running
 * "To Glen Innes") forks its distinct **head** into the convergence stop. Each
 * branch leaves the trunk on a short 45deg connector, then runs **horizontally**
 * in a lane in the gap **below** its row (stacking when several fork off the same
 * row); that row's gap is widened so the fork and its labels clear both the trunk
 * above and the next trunk row below. A variant that just ends early adds no
 * branch; one that shares neither end is returned in `separate`. Pixels.
 * @param variants - Stopping patterns for a single direction.
 * @param opts - Layout geometry.
 * @param canonId - Optional stop-id normaliser: maps a stop id to a canonical id
 *   for prefix/suffix comparison only (nodes keep their real ids). Use to treat
 *   same-named stops at different physical poles as the same stop.
 * @returns Placed nodes, edges, branch labels, and the pixel extent.
 */
export function buildBranchedSnake(
  variants: RouteVariant[],
  opts: SnakeOpts,
  canonId?: (id: string) => string,
): BranchedSnake {
  if (variants.length === 0) {
    return {
      nodes: [],
      edges: [],
      labels: [],
      width: 0,
      height: 0,
      separate: [],
      trunkHeadsign: null,
    };
  }

  const canon = canonId ?? ((id: string) => id);
  const { cols, col, row, padX, padTop, padBottom, branchDrop } = opts;
  const perRow = Math.max(1, cols);
  const maxBranch = opts.maxBranchStops ?? 6;
  const minBranch = opts.minBranchStops ?? 3;
  const labelReserve = opts.labelReserve ?? 0;
  const rightPad = opts.rightPad ?? 0;

  // Trunk = the busiest pattern (most trips), then the longest. The most-run
  // variant is the route's main service, so it forms the spine; the rest fork off.
  const ordered = [...variants].sort(
    (a, b) => b.tripCount - a.tripCount || b.stopIds.length - a.stopIds.length,
  );
  const trunk = ordered[0];

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const labels: BranchLabel[] = [];
  const separate: RouteVariant[] = [];

  // --- Pass 1: decide each non-trunk variant's branch (or set it aside) -------
  const tlen = trunk.stopIds.length;
  // Any stop already on the trunk must not appear again on a branch - it would
  // be drawn twice at different positions, which is confusing and incorrect.
  const trunkStopSet = new Set(trunk.stopIds.map(canon));
  const forkSpecs: {
    anchorIdx: number;
    branchStops: string[];
    dir: 1 | -1;
    headsign: string | null;
  }[] = [];
  for (let vi = 1; vi < ordered.length; vi++) {
    const v = ordered[vi];
    const vlen = v.stopIds.length;
    // Longest shared run at each end of the trunk: a leading prefix (same origin)
    // and a trailing suffix (same destination), kept from overlapping each other.
    let p = 0;
    while (p < vlen && p < tlen && canon(v.stopIds[p]) === canon(trunk.stopIds[p])) p++;
    let s = 0;
    while (
      s < vlen - p &&
      s < tlen &&
      canon(v.stopIds[vlen - 1 - s]) === canon(trunk.stopIds[tlen - 1 - s])
    )
      s++;
    if (p >= s) {
      // Divergent: shares the origin, splits off toward a different end (its tail
      // runs rightward). A pure prefix (tail=0) is a short-working whose stops
      // are all on the trunk - discard it silently. A diverging tail too short
      // to branch (< minBranch) is still a distinct service - render it as its
      // own line so it isn't invisible. Sharing neither end means separate.
      if (p === 0) {
        separate.push(v);
        continue;
      }
      if (vlen - p < minBranch) {
        // Only push as separate when there are actual unique tail stops; a pure
        // prefix (tail=0) is already represented by the trunk.
        if (vlen - p > 0) separate.push(v);
        continue;
      }
      // Variant ends at the same canonical stop as the trunk: it's a parallel road
      // to the same destination, not a genuinely different terminus. The branch
      // label would redundantly name the trunk's own destination.
      if (canon(v.stopIds[vlen - 1]) === canon(trunk.stopIds[tlen - 1])) continue;
      const divStops = v.stopIds.slice(p).filter((id) => !trunkStopSet.has(canon(id)));
      if (divStops.length === 0) continue;
      forkSpecs.push({
        anchorIdx: p - 1,
        branchStops: divStops.slice(0, maxBranch),
        dir: 1,
        headsign: v.headsign,
      });
    } else {
      // Convergent: a different origin merging into the shared destination path
      // (e.g. several starts all running "To Glen Innes"). Its distinct head forks
      // into the convergence stop and runs leftward, back toward that origin.
      // A pure suffix (a short-working that starts mid-trunk) is on the trunk: it
      // has no distinct origin stops, so it must not add a branch - otherwise it
      // leaves an orphan label with no line drawn. (A small but non-empty head is
      // still forked: a different origin is worth showing even when short.)
      if (vlen - s === 0) continue;
      // Middle deviation: variant shares both a prefix (p > 0) and a suffix, so it
      // has the same origin and destination as the trunk on a different intermediate
      // road. Its convergent "origin" would be the trunk's own start - no useful
      // branch label to add.
      if (p > 0) continue;
      const convStops = v.stopIds.slice(0, vlen - s).filter((id) => !trunkStopSet.has(canon(id)));
      if (convStops.length === 0) continue;
      forkSpecs.push({
        anchorIdx: Math.max(0, tlen - s),
        branchStops: convStops.reverse().slice(0, maxBranch),
        dir: -1,
        headsign: v.headsign,
      });
    }
  }

  // All convergent (dir === -1) forks go upward into the gap above their anchor row,
  // giving their 45deg connectors slope +1 (up-left). Divergent connectors also have
  // slope +1 (down-right). Parallel connectors can never cross, so no X patterns
  // form between a convergent and a divergent branch sharing the same trunk row.
  // Row-0 forks go above row 0; the extra padding needed is factored into rowYs[0].
  const isUpwardFork = forkSpecs.map((f) => f.dir === -1);

  // Pre-count downward (divergent, below row R) and upward (convergent, above row R)
  // forks per gap. Gap index g covers the space between row g and row g+1; index -1
  // is the space above row 0 (accommodated by increasing the top padding).
  const downPerRow = new Map<number, number>();
  const upPerGap = new Map<number, number>();
  forkSpecs.forEach((f, fi) => {
    const r = Math.floor(f.anchorIdx / perRow);
    if (isUpwardFork[fi]) {
      upPerGap.set(r - 1, (upPerGap.get(r - 1) ?? 0) + 1);
    } else {
      downPerRow.set(r, (downPerRow.get(r) ?? 0) + 1);
    }
  });

  // Lane index within each fork's own stack (downward or upward), so `drop` is
  // computed independently per direction: lane 0 is the shallowest in each stack.
  const downLaneIdx = new Map<number, number>();
  const upLaneIdx = new Map<number, number>();
  const forkLane = forkSpecs.map((f, fi) => {
    const r = Math.floor(f.anchorIdx / perRow);
    if (isUpwardFork[fi]) {
      const g = r - 1;
      const lane = upLaneIdx.get(g) ?? 0;
      upLaneIdx.set(g, lane + 1);
      return lane;
    }
    const lane = downLaneIdx.get(r) ?? 0;
    downLaneIdx.set(r, lane + 1);
    return lane;
  });

  // Convergent forks now go upward, so no row-0 convergent fork needs leftCols
  // space: they sit above row 0, not below it. Only divergent row-0 forks go down
  // (rightward) and they never extend to the left of padX.
  const leftCols = 0;

  // Ragged snake: row 0 is indented to columns leftCols..perRow-1 (its left is
  // taken by the forks above); every row below uses the full width 0..perRow-1, so
  // it reaches *under* those forks. The widest row is still perRow, so the diagram
  // stays ~card width (no shrinking, no horizontal scroll). Even rows run
  // left>right, odd rows right>left.
  const row0Count = Math.max(1, perRow - leftCols);
  /**
   * Grid cell for the i-th trunk stop in the ragged snake.
   * @param i - Trunk stop index (0-based).
   * @returns Its row `r`, grid column `gx`, and within-row index.
   */
  const cellOf = (i: number): { r: number; gx: number; within: number } => {
    if (i < row0Count) return { r: 0, gx: leftCols + i, within: i };
    const j = i - row0Count;
    const r = 1 + Math.floor(j / perRow);
    const within = j % perRow;
    return { r, gx: r % 2 === 1 ? perRow - 1 - within : within, within };
  };
  const numRows = tlen <= row0Count ? 1 : 1 + Math.ceil((tlen - row0Count) / perRow);

  // ~px a horizontal label reaches off its line (matches DiagramSvg's offset).
  const labelBand = 28;
  // Row-0 upward (convergent) branches sit in the space ABOVE row 0. Push row 0
  // down by branchDrop * count so those branches land at y > padTop instead of < 0.
  const row0UpLanes = upPerGap.get(-1) ?? 0;
  const effectivePadTop = padTop + branchDrop * row0UpLanes;
  const rowYs = [effectivePadTop];
  for (let r = 1; r < numRows; r++) {
    // Gap between row r-1 and row r must fit both downward branches leaving row r-1
    // and upward branches entering from row r (the gap is their shared space).
    // upPerGap index r-1 covers row-r convergent branches going up into this gap.
    const down = downPerRow.get(r - 1) ?? 0;
    const up = upPerGap.get(r - 1) ?? 0;
    const totalLanes = down + up;
    const gap = totalLanes > 0 ? branchDrop * totalLanes + 2 * labelBand + 8 : row;
    rowYs.push(rowYs[r - 1] + gap);
  }

  // Alternate each row's labels up/down by its within-row index. Row lengths are
  // even, so this puts the free vertical side at every turn (row start labels
  // below, row end above) and keeps same-side neighbours two columns apart.
  const trunkNodes: DiagramNode[] = trunk.stopIds.map((id, i) => {
    const { r, gx, within } = cellOf(i);
    return {
      stopId: id,
      cx: padX + gx * col,
      cy: rowYs[r] ?? padTop,
      branch: 0,
      labelDir: within % 2 === 0 ? "down" : "up",
    };
  });
  nodes.push(...trunkNodes);
  for (let i = 1; i < trunkNodes.length; i++) {
    const a = trunkNodes[i - 1];
    const b = trunkNodes[i];
    edges.push({ x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy, branch: false });
  }

  let maxCx = nodes.reduce((m, n) => Math.max(m, n.cx), 0);
  let minCx = nodes.reduce((m, n) => Math.min(m, n.cx), padX);
  let maxCy = nodes.reduce((m, n) => Math.max(m, n.cy), 0);

  // --- Pass 2: place each fork in its lane -----------------------------------
  // Downward forks sit in the gap below their anchor row; upward forks sit in the
  // gap above (between the previous row and the anchor row). Both use a 45deg
  // connector with equal horizontal run and vertical rise (`drop`), so upward
  // connectors slope up-left (+1) and downward ones slope down-right or down-left
  // (+1 or -1). Upward and downward connectors in the same gap are parallel and
  // can never cross each other.

  // Lane N's connector starts from lane N-1's first stop, not from the trunk
  // anchor, so each successive connector is a visible one-step diagonal rather
  // than being hidden beneath the outer lane's longer connector.
  const prevLaneFirstStop = new Map<string, { cx: number; cy: number }>();

  forkSpecs.forEach((f, fi) => {
    const fromCx = trunkNodes[f.anchorIdx].cx;
    const fromCy = trunkNodes[f.anchorIdx].cy;
    const up = isUpwardFork[fi];

    // On odd trunk rows (right-to-left travel), flip the horizontal direction so
    // divergent branches extend in the direction the trunk is travelling, not
    // against it.
    const anchorRow = Math.floor(f.anchorIdx / perRow);
    const hDir: 1 | -1 = anchorRow % 2 === 1 ? (-f.dir as 1 | -1) : f.dir;

    const anchorKey = `${fromCx},${fromCy},${up ? 1 : 0}`;
    const connectorStart = prevLaneFirstStop.get(anchorKey) ?? { cx: fromCx, cy: fromCy };

    const drop = branchDrop * (forkLane[fi] + 1);
    const laneY = up ? fromCy - drop : fromCy + drop;
    // Outer side (away from trunk) for label alternation: above for upward forks,
    // below for downward forks.
    const outerDir: LabelDir = up ? "up" : "down";
    const innerDir: LabelDir = up ? "down" : "up";
    f.branchStops.forEach((id, k) => {
      const cx = k === 0 ? fromCx + hDir * drop : nodes[nodes.length - 1].cx + hDir * col;
      const labelDir: LabelDir = k % 2 === 0 ? outerDir : innerDir;
      nodes.push({ stopId: id, cx, cy: laneY, branch: fi + 1, labelDir });
      if (k === 0) prevLaneFirstStop.set(anchorKey, { cx, cy: laneY });
      const prevCx = k === 0 ? connectorStart.cx : cx - hDir * col;
      const prevCy = k === 0 ? connectorStart.cy : laneY;
      edges.push({ x1: prevCx, y1: prevCy, x2: cx, y2: laneY, branch: true });
      maxCx = Math.max(maxCx, cx);
      minCx = Math.min(minCx, cx);
      maxCy = Math.max(maxCy, laneY);
    });
    const last = nodes[nodes.length - 1];
    labels.push({ headsign: f.headsign, cx: last.cx, cy: last.cy, toLeft: hDir < 0, toUp: up });
    // Reserve room for the branch end label on whichever side it sits.
    if (hDir < 0) minCx = Math.min(minCx, last.cx - labelReserve);
    else maxCx = Math.max(maxCx, last.cx + labelReserve);
  });

  // A leftward (convergent) branch can reach past the left edge; slide the whole
  // diagram right so its origin stops + label clear it (no-op without one).
  if (minCx < padX) {
    const shiftX = padX - minCx;
    for (const n of nodes) n.cx += shiftX;
    for (const e of edges) {
      e.x1 += shiftX;
      e.x2 += shiftX;
    }
    for (const l of labels) l.cx += shiftX;
    maxCx += shiftX;
  }

  // Always reserve room on the right for the angled delay labels.
  const reserve = rightPad;
  return {
    nodes,
    edges,
    labels,
    width: maxCx + padX + reserve,
    height: maxCy + padBottom,
    separate,
    trunkHeadsign: trunk.headsign,
  };
}
