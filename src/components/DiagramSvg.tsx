"use client";

import { delayColour } from "@/lib/delay-colour";
import { formatDelay } from "@/lib/format";
import type { BranchLabel, DiagramEdge, LabelDir } from "@/lib/route-graph";
import { useState, type JSX } from "react";

/** Max characters of a branch headsign before truncating. */
const BRANCH_LABEL_MAX = 20;

/** A diagram stop node with its resolved name + delay (serializable). */
export interface DiagramNodeView {
  stopId: string;
  cx: number;
  cy: number;
  /** 0 = trunk, > 0 = a branch track. */
  branch: number;
  name: string;
  /** Average delay (seconds) that day, or null when none recorded. */
  delay: number | null;
  /** Side to place this stop's time label (away from the line). */
  labelDir: LabelDir;
}

/** Props for {@link DiagramSvg}. */
export interface DiagramSvgProps {
  nodes: DiagramNodeView[];
  edges: DiagramEdge[];
  labels: BranchLabel[];
  /** Shared viewBox width across every diagram in the section (one scale). */
  viewWidth: number;
  height: number;
  /** Route mode, for the per-mode on-time colour banding. */
  mode: string;
  /** Draw the trunk as a closed loop (line returns to its start). */
  closed?: boolean;
  ariaLabel: string;
  /** Direction name, drawn next to the line's start node (origin). */
  lineLabel?: string;
  /** Stop id currently focused on the map, emphasised here with a halo. */
  selectedStopId?: string;
  /** Called with a stop id when its node is clicked, to focus it on the map. */
  onSelectStop?: (stopId: string) => void;
  /** Stop IDs with an active service alert; those nodes get a dashed disruption ring. */
  alertStopIds?: Set<string>;
  /** True when there is an active DETOUR alert for this route - dashes the trunk and branch lines. */
  hasDetour?: boolean;
  /**
   * Override the minimum viewBox width (default 1040). Pass a smaller value
   * when the diagram is displayed in a narrow grid cell so the content fills
   * the cell instead of being shrunk by the 1040px shared-scale floor.
   */
  minViewWidth?: number;
}

// --- Diagram sizing (tune these to make the line/nodes bigger or smaller) -----
/** Normal stop node radius + ring (px). */
const NODE_R = 7;
const NODE_STROKE = 4;
/** Terminus node radius + ring (px) - only slightly larger than a normal stop. */
const TERMINUS_R = 10;
const TERMINUS_STROKE = 5;
/** Trunk line thickness (px) - derived from node size. */
const TRUNK_STROKE = NODE_R + NODE_STROKE - 1;
/** Branch line thickness (px) - a touch thinner than the trunk. */
const BRANCH_STROKE = NODE_R + NODE_STROKE - 3;
/** Px a time label sits off its node centre (node outer edge + 3px gap). */
const LABEL_OFF = NODE_R + NODE_STROKE + 3;

/** A resolved label placement: text anchor point + alignment. */
interface Placement {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  baseline: "auto" | "hanging" | "central";
}

/** A laid-out label's bounding box (px). */
interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Approx line-box height of a 12px time label (px). */
const LABEL_H = 13;

/**
 * Sides to try when resolving a label, preferred first: the wanted side, then
 * its opposite, then the two horizontals. Lets a label dodge a line/neighbour
 * without ever leaving the node's vicinity.
 */
const LABEL_ORDER: Record<LabelDir, LabelDir[]> = {
  up: ["up", "down", "right", "left"],
  down: ["down", "up", "right", "left"],
  left: ["left", "right", "up", "down"],
  right: ["right", "left", "up", "down"],
};

/**
 * Whether two label boxes overlap (with a small slack so touching edges pass).
 * @param a - First box.
 * @param b - Second box.
 * @returns True when they intersect.
 */
function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  const p = 1.5;
  return a.x0 < b.x1 - p && b.x0 < a.x1 - p && a.y0 < b.y1 - p && b.y0 < a.y1 - p;
}

/**
 * Whether any drawn segment passes through a label box. Samples each segment
 * every ~3px - cheap and exact enough for the diagonal fork connectors that a
 * pure axis test would miss.
 * @param segs - Line segments as `[x1, y1, x2, y2]`.
 * @param b - The label box.
 * @returns True when a segment crosses the box.
 */
function boxHitsSeg(segs: [number, number, number, number][], b: LabelBox): boolean {
  // Negative p expands the hit box, requiring segments to be at least 3px
  // outside the label boundary - adds visual clearance from diagonal connectors.
  const p = -3;
  const bx0 = b.x0 + p;
  const by0 = b.y0 + p;
  const bx1 = b.x1 - p;
  const by1 = b.y1 - p;
  return segs.some(([x1, y1, x2, y2]) => {
    const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      if (px > bx0 && px < bx1 && py > by0 && py < by1) return true;
    }
    return false;
  });
}

/**
 * Place a stop's time label on the given side, clear of the line: up/down sit
 * centred above/below; left/right sit beside the node, vertically centred.
 * @param cx - Stop centre x.
 * @param cy - Stop centre y.
 * @param dir - Side to place the label.
 * @returns The text `x`/`y`, horizontal `anchor`, and vertical `baseline`.
 */
function labelPlacement(cx: number, cy: number, dir: LabelDir): Placement {
  return offsetPlacement(cx, cy, dir, LABEL_OFF);
}

/**
 * Like {@link labelPlacement} but at an arbitrary distance from the node, for
 * pushing a label hemmed in by lines/labels further out along a side.
 * @param cx - Stop centre x.
 * @param cy - Stop centre y.
 * @param dir - Side to place on.
 * @param dist - Distance from the node centre (px).
 * @returns The placement.
 */
function offsetPlacement(cx: number, cy: number, dir: LabelDir, dist: number): Placement {
  switch (dir) {
    case "up":
      return { x: cx, y: cy - dist, anchor: "middle", baseline: "auto" };
    case "down":
      return { x: cx, y: cy + dist, anchor: "middle", baseline: "hanging" };
    case "left":
      return { x: cx - dist, y: cy, anchor: "end", baseline: "central" };
    case "right":
      return { x: cx + dist, y: cy, anchor: "start", baseline: "central" };
  }
}

/**
 * Client renderer for one line diagram: an AT-style transit map drawn at a fixed
 * pixel scale (so every direction matches), with a hover/focus tooltip showing
 * each station's name and delay.
 * @param props - The resolved layout to draw.
 * @param props.nodes - Stop nodes with resolved name + delay.
 * @param props.edges - Trunk and branch segments.
 * @param props.labels - Branch end labels.
 * @param props.viewWidth - Shared viewBox width for a consistent scale.
 * @param props.height - SVG viewBox height in px.
 * @param props.mode - Route mode (drives the early/late colour banding).
 * @param props.closed - Draw the trunk as a closed loop.
 * @param props.ariaLabel - Accessible label for the SVG.
 * @param props.selectedStopId - Stop id focused on the map (emphasised here).
 * @param props.onSelectStop - Called with a stop id when its node is clicked.
 * @param props.alertStopIds - Stop ids with active alerts (drawn with a warning badge).
 * @param props.hasDetour - When true, dashes the route lines to indicate a detour.
 * @param props.minViewWidth - Minimum viewBox width (default 1040); pass lower in grid mode.
 * @returns The diagram element.
 */
export function DiagramSvg({
  nodes,
  edges,
  labels,
  viewWidth,
  height,
  mode,
  closed,
  ariaLabel,
  selectedStopId,
  onSelectStop,
  alertStopIds,
  hasDetour,
  minViewWidth = 1040,
}: DiagramSvgProps): JSX.Element {
  const [hovered, setHovered] = useState<number | null>(null);

  const trunk = nodes.filter((n) => n.branch === 0);
  // Close the loop by returning to the first stop when `closed`.
  const trunkPoints = [...trunk, ...(closed && trunk.length > 0 ? [trunk[0]] : [])]
    .map((n) => `${n.cx},${n.cy}`)
    .join(" ");
  const first = trunk[0];
  const last = trunk[trunk.length - 1];
  const tip = hovered == null ? null : nodes[hovered];

  // Every drawn line a time label must avoid: the trunk spine (incl. the loop-
  // closing edge) and every 45deg branch connector. Labels resolve against these
  // so none is ever drawn across a line, diagonal connectors included.
  const spine = [...trunk, ...(closed && trunk.length > 0 ? [trunk[0]] : [])];
  const segs: [number, number, number, number][] = [];
  for (let i = 1; i < spine.length; i++) {
    segs.push([spine[i - 1].cx, spine[i - 1].cy, spine[i].cx, spine[i].cy]);
  }
  for (const e of edges) if (e.branch) segs.push([e.x1, e.y1, e.x2, e.y2]);

  // Boxes already claimed by a label, so the next label can dodge them too.
  const placedBoxes: LabelBox[] = [];
  /**
   * Bounding box of a placed label, resolving its anchor/baseline to top-left.
   * @param lp - The label placement.
   * @param w - Text width (px).
   * @param h - Text line-box height (px).
   * @returns The label's box.
   */
  const lpToBox = (lp: Placement, w: number, h: number): LabelBox => {
    const x0 = lp.anchor === "end" ? lp.x - w : lp.anchor === "middle" ? lp.x - w / 2 : lp.x;
    const y0 =
      lp.baseline === "hanging" ? lp.y : lp.baseline === "central" ? lp.y - h / 2 : lp.y - h;
    return { x0, y0, x1: x0 + w, y1: y0 + h };
  };
  /**
   * Resolve a label to the first side (preferred, then opposite, then the
   * horizontals) whose box clears every line and every placed label; fall back
   * to the first side that at least clears the lines, then to the preferred
   * side. Registers the chosen box so later labels avoid it.
   * @param cx - Stop centre x.
   * @param cy - Stop centre y.
   * @param dir - Preferred side.
   * @param w - Text width (px).
   * @param h - Text line-box height (px).
   * @returns The chosen placement, or null when every position crosses a line segment.
   */
  const place = (cx: number, cy: number, dir: LabelDir, w: number, h: number): Placement | null => {
    let segClear: { lp: Placement; box: LabelBox } | null = null;
    for (const d of LABEL_ORDER[dir]) {
      const lp = labelPlacement(cx, cy, d);
      const box = lpToBox(lp, w, h);
      if (boxHitsSeg(segs, box)) continue;
      if (!placedBoxes.some((p) => boxesOverlap(p, box))) {
        placedBoxes.push(box);
        return lp;
      }
      segClear ??= { lp, box };
    }
    // Every standard side is blocked: a node hemmed in by diagonal fork connectors
    // or sitting on a bend. Push the label out in growing steps, trying each side
    // (preferred order) at each distance, until it clears the lines and the labels.
    for (let k = 2; k <= 3; k++) {
      for (const d of LABEL_ORDER[dir]) {
        const lp = offsetPlacement(cx, cy, d, LABEL_OFF * k);
        const box = lpToBox(lp, w, h);
        if (!boxHitsSeg(segs, box) && !placedBoxes.some((p) => boxesOverlap(p, box))) {
          placedBoxes.push(box);
          return lp;
        }
      }
    }
    // No position at any distance clears the surrounding line segments - skip
    // this label rather than drawing it across a connector or turn.
    if (!segClear) return null;
    placedBoxes.push(segClear.box);
    return segClear.lp;
  };

  // Per-node time label placement (resolved clear of every line + placed label;
  // also feeds the content-bounds calc below). Done before the branch end labels
  // so those can dodge the dense time labels rather than the other way round. The
  // terminus shows its own delay like any other stop - the direction title at the
  // top names the line, so the end node carries no separate name label.
  const nodeLabels = nodes.map((n) => {
    const value = n.delay == null ? null : formatDelay(n.delay);
    if (value == null) return { value: null as string | null, lp: null };
    const lp = place(n.cx, n.cy, n.labelDir, value.length * 7, LABEL_H);
    return { value, lp };
  });

  // Branch end labels (origin / divergent terminus) go last, nudged down until
  // they clear the other end labels, the trunk's vertical turns, and every time
  // label already placed.
  const placedEndLabels: { x0: number; x1: number; y: number }[] = [];
  const endLabels = labels.map((l) => {
    const head = l.headsign ?? "variant";
    const parts = head.split(" To ");
    const raw = parts.length < 2 ? head : l.toLeft ? parts[0] : parts.slice(1).join(" To ");
    // Strip "Via ..." qualifier - redundant in a short branch label.
    const display = raw.replace(/\s+Via\s+.*/i, "").trim();
    const text =
      display.length > BRANCH_LABEL_MAX ? `${display.slice(0, BRANCH_LABEL_MAX - 1)}…` : display;
    const w = text.length * 8;
    const endOff = NODE_R + NODE_STROKE + 9;
    const x0 = l.toLeft ? l.cx - endOff - w : l.cx + endOff;
    const x1 = l.toLeft ? l.cx - endOff : l.cx + endOff + w;
    let y = l.cy;
    /**
     * This end label's box at a trial y. Matches the actual render: the dy=4
     * baseline shift, with ~15px of glyph height above the baseline.
     * @param yy - Trial baseline y.
     * @returns The label box.
     */
    const endBox = (yy: number): LabelBox => ({ x0, y0: yy + 4 - 15, x1, y1: yy + 4 });
    for (let guard = 0; guard < 32; guard++) {
      const box = endBox(y);
      const hitsEnd = placedEndLabels.some((p) => Math.abs(p.y - y) < 18 && p.x0 < x1 && x0 < p.x1);
      // Clear of every drawn line (trunk turns + diagonal connectors), the other
      // end labels, and the placed time labels.
      if (!hitsEnd && !boxHitsSeg(segs, box) && !placedBoxes.some((p) => boxesOverlap(p, box))) {
        break;
      }
      y += l.toUp ? -18 : 18;
    }
    // If the primary sweep exhausted without clearing, try the opposite direction.
    {
      const finalBox = endBox(y);
      const finalBlocked =
        placedEndLabels.some((p) => Math.abs(p.y - y) < 18 && p.x0 < x1 && x0 < p.x1) ||
        boxHitsSeg(segs, finalBox) ||
        placedBoxes.some((p) => boxesOverlap(p, finalBox));
      if (finalBlocked) {
        const step = l.toUp ? 18 : -18;
        let yAlt = l.cy;
        for (let g2 = 0; g2 < 32; g2++) {
          yAlt += step;
          const box = endBox(yAlt);
          const blocked =
            placedEndLabels.some((p) => Math.abs(p.y - yAlt) < 18 && p.x0 < x1 && x0 < p.x1) ||
            boxHitsSeg(segs, box) ||
            placedBoxes.some((p) => boxesOverlap(p, box));
          if (!blocked) {
            y = yAlt;
            break;
          }
        }
      }
    }
    placedEndLabels.push({ x0, x1, y });
    placedBoxes.push(endBox(y));
    return { text, y, endOff };
  });

  // Trim the viewBox to the actual drawn content (nodes + every label) so the
  // diagram fills the width instead of leaving the fixed reserves as blank margin.
  // A minimum width keeps short routes from blowing up to fill the card.
  const xs: number[] = [];
  nodes.forEach((n, i) => {
    const r = n.branch === 0 && (n === first || n === last) ? TERMINUS_R : NODE_R;
    xs.push(n.cx - r, n.cx + r);
    const nl = nodeLabels[i];
    if (nl.value && nl.lp) {
      const w = nl.value.length * 7;
      const lx =
        nl.lp.anchor === "end"
          ? nl.lp.x - w
          : nl.lp.anchor === "middle"
            ? nl.lp.x - w / 2
            : nl.lp.x;
      xs.push(lx, lx + w);
    }
  });
  for (const p of placedEndLabels) xs.push(p.x0, p.x1);
  // (The direction title is centred in the final width below, so it doesn't drive bounds.)
  let minX = Infinity;
  let maxX = -Infinity;
  for (const x of xs) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  const PAD = 6;
  const contentW = xs.length ? maxX - minX + 2 * PAD : viewWidth;
  // All diagrams in one section share the same viewBox width (the widest of the
  // set), so every diagram renders at a consistent scale - a shorter route doesn't
  // blow up to fill the card while a wider one looks tiny beside it.
  const vw = Math.max(contentW, viewWidth, minViewWidth);
  const vx = (xs.length ? minX - PAD : 0) - (vw - contentW) / 2;

  return (
    <div className="relative">
      <div className="relative">
        <svg
          viewBox={`${vx} 0 ${vw} ${height}`}
          preserveAspectRatio="xMinYMid meet"
          role="img"
          aria-label={ariaLabel}
          className="block h-auto w-full"
        >
          {/* Bold rounded trunk; 90deg snake turns read as smooth bends.
              Dashed when there is an active DETOUR alert (planned path may not match reality). */}
          <polyline
            points={trunkPoints}
            fill="none"
            strokeWidth={TRUNK_STROKE}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="stroke-at-shore"
            strokeDasharray={hasDetour ? "8 4" : undefined}
          />
          {/* Branches (45deg out, then horizontal): same route blue as the trunk,
              a touch thinner so the main line still reads as the spine. */}
          {edges
            .filter((e) => e.branch)
            .map((e, i) => (
              <line
                key={`b${i}`}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                strokeWidth={BRANCH_STROKE}
                strokeLinecap="round"
                className="stroke-at-shore"
                strokeDasharray={hasDetour ? "8 4" : undefined}
              />
            ))}
          {nodes.map((n, idx) => {
            const { value, lp } = nodeLabels[idx];
            const terminus = n.branch === 0 && (n === first || n === last);
            const r = terminus ? TERMINUS_R : NODE_R;
            const selected = selectedStopId != null && n.stopId === selectedStopId;
            return (
              <g key={`${n.branch}-${idx}`}>
                {value && lp && (
                  <text
                    x={lp.x}
                    y={lp.y}
                    textAnchor={lp.anchor}
                    dominantBaseline={lp.baseline}
                    className="fill-at-ink text-[12px] font-semibold"
                  >
                    {value}
                  </text>
                )}
                {/* Dashed disruption ring for stops named in an active service alert. */}
                {alertStopIds?.has(n.stopId) && (
                  <circle
                    cx={n.cx}
                    cy={n.cy}
                    r={r + 5}
                    strokeWidth={2.5}
                    fill="none"
                    stroke="var(--color-at-disruption)"
                    strokeDasharray="4 2"
                  />
                )}
                {/* Halo behind the focused stop, so the diagram click and the map
                    pan visibly point at the same station. */}
                {selected && (
                  <circle
                    cx={n.cx}
                    cy={n.cy}
                    r={r + 5}
                    strokeWidth={2}
                    className="fill-none stroke-at-ink"
                  />
                )}
                <circle
                  cx={n.cx}
                  cy={n.cy}
                  r={r}
                  strokeWidth={terminus ? TERMINUS_STROKE : NODE_STROKE}
                  stroke={delayColour(n.delay, mode)}
                  className="fill-at-surface"
                />
                {/* Transparent hit area: larger target for hover/focus/click. */}
                <circle
                  cx={n.cx}
                  cy={n.cy}
                  r={14}
                  fill="transparent"
                  tabIndex={0}
                  role={onSelectStop ? "button" : undefined}
                  className="cursor-pointer outline-none"
                  onMouseEnter={() => setHovered(idx)}
                  onMouseLeave={() => setHovered((h) => (h === idx ? null : h))}
                  onFocus={() => setHovered(idx)}
                  onBlur={() => setHovered((h) => (h === idx ? null : h))}
                  onClick={() => onSelectStop?.(n.stopId)}
                  onKeyDown={(e) => {
                    if (onSelectStop && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onSelectStop(n.stopId);
                    }
                  }}
                >
                  <title>
                    {`${n.name}${n.delay == null ? " · no data" : ` · ${formatDelay(n.delay)}`}`}
                  </title>
                </circle>
              </g>
            );
          })}
          {/* Branch end labels (origin or divergent terminus), on the branch's side. */}
          {/* Branch end labels: named by the end that differs from the trunk (a
              convergent branch by its origin, a divergent one by its destination). */}
          {labels.map((l, i) => (
            <text
              key={`l${i}`}
              x={l.cx}
              y={endLabels[i].y}
              dx={l.toLeft ? -endLabels[i].endOff : endLabels[i].endOff}
              dy={4}
              textAnchor={l.toLeft ? "end" : "start"}
              className="fill-at-muted text-[14px] font-bold"
            >
              {endLabels[i].text}
            </text>
          ))}
        </svg>
        {tip && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-at-border bg-at-surface px-2 py-1 text-xs whitespace-nowrap shadow-md"
            style={{
              left: `${((tip.cx - vx) / vw) * 100}%`,
              top: `${(tip.cy / height) * 100}%`,
            }}
          >
            <span className="font-semibold text-at-ink">{tip.name}</span>
            <span className="ml-1 text-at-muted">
              {tip.delay == null ? "no data" : formatDelay(tip.delay)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
