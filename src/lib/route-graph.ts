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
  const empty = { nodes: [], edges: [], labels: [], width: 0, height: 0 };
  if (variants.length === 0) return empty;

  const { cols, col, row, padX, padTop, padBottom, branchStep } = opts;
  const perRow = Math.max(1, cols);
  const maxBranch = opts.maxBranchStops ?? 6;

  const ordered = [...variants].sort(
    (a, b) => b.tripCount - a.tripCount || b.stopIds.length - a.stopIds.length,
  );
  const trunk = ordered[0];

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const labels: BranchLabel[] = [];

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
    const tail = v.stopIds.slice(p, p + maxBranch);
    if (tail.length === 0) continue; // pure prefix / ends early: already on the trunk

    branchIdx++;
    // Divergence anchor: the last shared trunk node, or a fresh row below if none.
    let fromCx: number;
    let fromCy: number;
    if (p > 0) {
      fromCx = trunkNodes[p - 1].cx;
      fromCy = trunkNodes[p - 1].cy;
    } else {
      fromCx = padX;
      fromCy = maxCy + row;
    }

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
  }

  return { nodes, edges, labels, width: maxCx + padX, height: maxCy + padBottom };
}
