// src/lib/route-graph.ts
import type { RouteVariant } from "@/types/api";

/** A stop placed on the diagram, in pixels (`branch` 0 = trunk). */
export interface DiagramNode {
  stopId: string;
  cx: number;
  cy: number;
  branch: number;
}

/** A segment between two placed stops, in pixels. */
export interface DiagramEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** True for a 45deg branch segment (drawn muted); false for trunk. */
  diagonal: boolean;
}

/** A branch's headsign label, at the branch's last stop (pixels). */
export interface BranchLabel {
  headsign: string | null;
  cx: number;
  cy: number;
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
  /** Px step for each branch stop (equal in x and y -> 45deg). */
  branchStep: number;
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
 * Lay a direction's variants out as a metro-style trunk with 45deg branches.
 * The busiest (then longest) variant is the **trunk**, snake-wrapped
 * (boustrophedon) so it stays on-screen. Every other variant is aligned to the
 * trunk by shared leading stops; its divergent **tail** forks off the trunk node
 * at the divergence point on a 45deg down-right diagonal. A variant that is just
 * a shorter prefix (ends early) adds no branch. Coordinates are pixels.
 * @param variants - Stopping patterns for a single direction.
 * @param opts - Layout geometry.
 * @returns Placed nodes, edges, branch labels, and the pixel extent.
 */
export function buildBranchedSnake(variants: RouteVariant[], opts: SnakeOpts): BranchedSnake {
  if (variants.length === 0) {
    return { nodes: [], edges: [], labels: [], width: 0, height: 0, separate: [] };
  }

  const { cols, col, row, padX, padTop, padBottom, branchStep } = opts;
  const perRow = Math.max(1, cols);
  const maxBranch = opts.maxBranchStops ?? 6;
  const minBranch = opts.minBranchStops ?? 3;
  const labelReserve = opts.labelReserve ?? 0;
  const rightPad = opts.rightPad ?? 0;

  const ordered = [...variants].sort(
    (a, b) => b.tripCount - a.tripCount || b.stopIds.length - a.stopIds.length,
  );
  const trunk = ordered[0];

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const labels: BranchLabel[] = [];
  const separate: RouteVariant[] = [];

  // Snake-lay the trunk: even rows left->right, odd rows right->left.
  const trunkNodes: DiagramNode[] = trunk.stopIds.map((id, i) => {
    const r = Math.floor(i / perRow);
    const within = i % perRow;
    const gx = r % 2 === 0 ? within : perRow - 1 - within;
    return { stopId: id, cx: padX + gx * col, cy: padTop + r * row, branch: 0 };
  });
  nodes.push(...trunkNodes);
  for (let i = 1; i < trunkNodes.length; i++) {
    const a = trunkNodes[i - 1];
    const b = trunkNodes[i];
    edges.push({ x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy, diagonal: false });
  }

  let maxCx = nodes.reduce((m, n) => Math.max(m, n.cx), 0);
  let maxCy = nodes.reduce((m, n) => Math.max(m, n.cy), 0);
  let branchIdx = 0;

  for (let vi = 1; vi < ordered.length; vi++) {
    const v = ordered[vi];
    // Common leading-stop prefix with the trunk.
    let p = 0;
    while (p < v.stopIds.length && p < trunk.stopIds.length && v.stopIds[p] === trunk.stopIds[p]) {
      p++;
    }
    // Only fork variants that share an origin with the trunk and then diverge.
    // A pure prefix (ends early) is already on the trunk; a variant that shares
    // no leading stop is a separate pattern, not a branch - skip both.
    if (p === 0) {
      // Shares no origin with the trunk: a separate pattern, drawn on its own line.
      separate.push(v);
      continue;
    }
    // Ignore trivial divergences (ends early, or only a stop or two different):
    // the variant is essentially the trunk, so it adds no branch.
    if (v.stopIds.length - p < minBranch) continue;
    const tail = v.stopIds.slice(p, p + maxBranch);

    branchIdx++;
    const fromCx = trunkNodes[p - 1].cx;
    const fromCy = trunkNodes[p - 1].cy;

    tail.forEach((id, k) => {
      const cx = fromCx + (k + 1) * branchStep;
      const cy = fromCy + (k + 1) * branchStep;
      nodes.push({ stopId: id, cx, cy, branch: branchIdx });
      const prevCx = fromCx + k * branchStep;
      const prevCy = fromCy + k * branchStep;
      edges.push({ x1: prevCx, y1: prevCy, x2: cx, y2: cy, diagonal: true });
      maxCx = Math.max(maxCx, cx);
      maxCy = Math.max(maxCy, cy);
    });
    const last = nodes[nodes.length - 1];
    labels.push({ headsign: v.headsign, cx: last.cx, cy: last.cy });
    // Keep the branch end label inside the canvas.
    maxCx = Math.max(maxCx, last.cx + labelReserve);
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
  };
}
