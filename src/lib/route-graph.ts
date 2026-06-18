// src/lib/route-graph.ts
import type { RouteVariant } from "@/types/api";

/** A stop placed on the diagram grid (column `x`, track `y`; trunk is y=0). */
export interface DiagramNode {
  stopId: string;
  x: number;
  y: number;
}

/** A segment between two adjacent stops on a variant's path. */
export interface DiagramEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** True when the segment touches a branch track (drawn muted). */
  branch: boolean;
}

/** A branch's headsign label, positioned at the branch's first stop. */
export interface BranchLabel {
  headsign: string | null;
  x: number;
  y: number;
}

/** A laid-out branching line for one direction (trunk + branch tracks). */
export interface BranchedLine {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  labels: BranchLabel[];
  /** Column count (max x + 1). */
  width: number;
  /** Track count (max y + 1). */
  height: number;
}

/**
 * Lay out one direction's variants as a metro-style trunk with branches.
 * The most-frequent (then longest) variant is the trunk on track y=0; every
 * other variant snaps its shared stops onto the trunk and routes each maximal
 * run of unshared stops onto its own parallel track. A variant that is just a
 * shorter version of the trunk (ends early / via a subset) adds no branch.
 * @param variants - Stopping patterns for a single direction.
 * @returns Nodes, edges, branch labels, and the grid extent.
 */
export function buildBranchedLine(variants: RouteVariant[]): BranchedLine {
  if (variants.length === 0) return { nodes: [], edges: [], labels: [], width: 0, height: 0 };

  const ordered = [...variants].sort(
    (a, b) => b.tripCount - a.tripCount || b.stopIds.length - a.stopIds.length,
  );
  const trunk = ordered[0];

  // Trunk: first occurrence of each stop fixes its column on track 0.
  const trunkX = new Map<string, number>();
  trunk.stopIds.forEach((id, i) => {
    if (!trunkX.has(id)) trunkX.set(id, i);
  });

  const nodes = new Map<string, DiagramNode>();
  trunk.stopIds.forEach((id, i) => {
    if (!nodes.has(id)) nodes.set(id, { stopId: id, x: i, y: 0 });
  });

  const edges: DiagramEdge[] = [];
  const labels: BranchLabel[] = [];
  let maxX = trunk.stopIds.length - 1;
  let maxY = 0;

  /**
   * Record an edge between two placed nodes.
   * @param a - Start node.
   * @param b - End node.
   */
  const addEdge = (a: DiagramNode, b: DiagramNode): void => {
    edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, branch: a.y !== 0 || b.y !== 0 });
  };

  for (let i = 1; i < trunk.stopIds.length; i++) {
    addEdge(nodes.get(trunk.stopIds[i - 1])!, nodes.get(trunk.stopIds[i])!);
  }

  let nextTrack = 1;
  for (let vi = 1; vi < ordered.length; vi++) {
    const v = ordered[vi];
    let track = -1; // current branch track (-1 = on trunk)
    let cursorX = 0; // column for the next branch stop
    let labelled = false;
    let prev: DiagramNode | null = null;

    for (const id of v.stopIds) {
      let node: DiagramNode;
      if (trunkX.has(id)) {
        track = -1;
        node = nodes.get(id)!;
      } else {
        const existing = nodes.get(id);
        if (existing) {
          node = existing;
        } else {
          if (track === -1) {
            track = nextTrack++;
            cursorX = prev ? prev.x : 0;
          }
          cursorX += 1;
          node = { stopId: id, x: cursorX, y: track };
          nodes.set(id, node);
          maxX = Math.max(maxX, cursorX);
          maxY = Math.max(maxY, track);
        }
      }
      if (prev) addEdge(prev, node);
      if (!labelled && node.y !== 0) {
        labels.push({ headsign: v.headsign, x: node.x, y: node.y });
        labelled = true;
      }
      prev = node;
    }
  }

  return { nodes: [...nodes.values()], edges, labels, width: maxX + 1, height: maxY + 1 };
}
