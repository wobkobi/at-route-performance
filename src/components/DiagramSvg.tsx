"use client";

import { cn } from "@/lib/cn";
import { formatDelay } from "@/lib/format";
import type { BranchLabel, DiagramEdge } from "@/lib/route-graph";
import { useState, type JSX } from "react";

/** Max characters of a branch headsign before truncating. */
const BRANCH_LABEL_MAX = 24;

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
}

/** Props for {@link DiagramSvg}. */
export interface DiagramSvgProps {
  nodes: DiagramNodeView[];
  edges: DiagramEdge[];
  labels: BranchLabel[];
  /** Shared viewBox width across every diagram in the section (one scale). */
  viewWidth: number;
  height: number;
  thresholdSec: number;
  ariaLabel: string;
}

/**
 * Tailwind `stroke-*` utility for a station ring, by its average delay.
 * @param delay - Average delay in seconds, or null when unknown.
 * @param thresholdSec - Threshold for late/early banding.
 * @returns A stroke utility class.
 */
function ringClass(delay: number | null, thresholdSec: number): string {
  if (delay == null) return "stroke-at-border";
  if (delay > thresholdSec) return "stroke-at-late";
  if (delay < -thresholdSec) return "stroke-at-early";
  return "stroke-at-ontime";
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
 * @param props.thresholdSec - Threshold (s) for early/late colour banding.
 * @param props.ariaLabel - Accessible label for the SVG.
 * @returns The diagram element.
 */
export function DiagramSvg({
  nodes,
  edges,
  labels,
  viewWidth,
  height,
  thresholdSec,
  ariaLabel,
}: DiagramSvgProps): JSX.Element {
  const [hovered, setHovered] = useState<number | null>(null);

  const trunk = nodes.filter((n) => n.branch === 0);
  const trunkPoints = trunk.map((n) => `${n.cx},${n.cy}`).join(" ");
  const first = trunk[0];
  const last = trunk[trunk.length - 1];
  const tip = hovered == null ? null : nodes[hovered];

  return (
    <div className={cn("relative")}>
      <div className={cn("relative")}>
        <svg
          viewBox={`0 0 ${viewWidth} ${height}`}
          preserveAspectRatio="xMinYMid meet"
          role="img"
          aria-label={ariaLabel}
          className={cn("block h-auto w-full")}
        >
          {/* Bold rounded trunk; 90deg snake turns read as smooth bends. */}
          <polyline
            points={trunkPoints}
            fill="none"
            strokeWidth={7}
            strokeLinejoin="round"
            strokeLinecap="round"
            className={cn("stroke-at-shore")}
          />
          {/* Divergent branches at 45deg, drawn muted and thinner. */}
          {edges
            .filter((e) => e.diagonal)
            .map((e, i) => (
              <line
                key={`b${i}`}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                strokeWidth={4}
                strokeLinecap="round"
                className={cn("stroke-at-muted")}
              />
            ))}
          {nodes.map((n, idx) => {
            const label = n.delay == null ? null : formatDelay(n.delay, { thresholdSec });
            const terminus = n.branch === 0 && (n === first || n === last);
            return (
              <g key={`${n.branch}-${idx}`}>
                {label && (
                  <text
                    x={n.cx}
                    y={n.cy}
                    dx={8}
                    dy={3}
                    textAnchor="start"
                    transform={`rotate(-45 ${n.cx} ${n.cy})`}
                    className={cn("fill-at-ink text-[10px] font-semibold")}
                  >
                    {label}
                  </text>
                )}
                <circle
                  cx={n.cx}
                  cy={n.cy}
                  r={terminus ? 6.5 : 4.5}
                  strokeWidth={terminus ? 3.5 : 3}
                  className={cn("fill-at-surface", ringClass(n.delay, thresholdSec))}
                />
                {/* Transparent hit area: larger target for hover/focus. */}
                <circle
                  cx={n.cx}
                  cy={n.cy}
                  r={11}
                  fill="transparent"
                  tabIndex={0}
                  className={cn("cursor-pointer outline-none")}
                  onMouseEnter={() => setHovered(idx)}
                  onMouseLeave={() => setHovered((h) => (h === idx ? null : h))}
                  onFocus={() => setHovered(idx)}
                  onBlur={() => setHovered((h) => (h === idx ? null : h))}
                >
                  <title>{`${n.name}${label ? ` · ${label}` : " · no data"}`}</title>
                </circle>
              </g>
            );
          })}
          {/* Branch destinations. */}
          {labels.map((l, i) => {
            const head = l.headsign ?? "variant";
            const text =
              head.length > BRANCH_LABEL_MAX ? `${head.slice(0, BRANCH_LABEL_MAX - 1)}…` : head;
            return (
              <text
                key={`l${i}`}
                x={l.cx}
                y={l.cy}
                dx={9}
                dy={4}
                textAnchor="start"
                className={cn("fill-at-muted text-[10px] font-semibold")}
              >
                {text}
              </text>
            );
          })}
        </svg>
        {tip && (
          <div
            className={cn(
              "pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full",
              "rounded-md bg-at-ink px-2 py-1 text-xs whitespace-nowrap text-white shadow-md",
            )}
            style={{ left: `${(tip.cx / viewWidth) * 100}%`, top: `${(tip.cy / height) * 100}%` }}
          >
            <span className={cn("font-semibold")}>{tip.name}</span>
            <span className={cn("ml-1 text-white/80")}>
              {tip.delay == null ? "no data" : formatDelay(tip.delay, { thresholdSec })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
