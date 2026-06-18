import { cn } from "@/lib/cn";
import { formatDelay } from "@/lib/format";
import { buildBranchedSnake, type SnakeOpts } from "@/lib/route-graph";
import type { RoutePattern } from "@/types/api";
import type { JSX } from "react";

/** Props for {@link RouteLineDiagram}. */
export interface RouteLineDiagramProps {
  /** The route's stopping patterns grouped by direction. */
  directions: RoutePattern["directions"];
  /** Average delay (seconds) per stop id; null/absent renders neutral. */
  delayByStop: Map<string, number | null>;
  /** Stop id to display name. */
  nameByStop: Map<string, string>;
  /** Threshold (seconds) beyond which a stop is coloured late/early. */
  thresholdSec: number;
}

/** Compact metro-style layout geometry (pixels). */
const OPTS: SnakeOpts = {
  cols: 12,
  col: 34,
  row: 64,
  padX: 20,
  padTop: 66,
  padBottom: 24,
  branchStep: 30,
  maxBranchStops: 6,
};

/**
 * Tailwind `stroke-*` utility for a station ring, by its average delay.
 * @param delay - Average delay in seconds, or null when unknown.
 * @param thresholdSec - Threshold for late/early banding.
 * @returns A stroke utility class.
 */
function ringClass(delay: number | null | undefined, thresholdSec: number): string {
  if (delay == null) return "stroke-at-border";
  if (delay > thresholdSec) return "stroke-at-late";
  if (delay < -thresholdSec) return "stroke-at-early";
  return "stroke-at-ontime";
}

/**
 * Per-direction stop diagram in the style of AT's rapid-transit map: a bold,
 * rounded trunk line that snake-wraps to stay on-screen, divergent trip variants
 * forking off at 45deg, and white stations ringed by their average delay.
 * Server-rendered SVG.
 * @param props - Diagram props.
 * @param props.directions - Stopping patterns grouped by direction.
 * @param props.delayByStop - Average delay per stop id.
 * @param props.nameByStop - Stop id to display name.
 * @param props.thresholdSec - Threshold (s) for early/late colour banding.
 * @returns The diagram element, or an empty note when no pattern is available.
 */
export function RouteLineDiagram({
  directions,
  delayByStop,
  nameByStop,
  thresholdSec,
}: RouteLineDiagramProps): JSX.Element {
  const dirKeys = Object.keys(directions)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <section className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
      <h2 className={cn("mb-1 text-lg font-semibold")}>Line diagram</h2>
      <p className={cn("mb-3 text-xs text-at-muted")}>
        Stops in order per direction. Branches show where some trips end at different spots; each
        stop is ringed by its average delay.
      </p>
      {dirKeys.length === 0 ? (
        <p className={cn("text-sm text-at-muted")}>No schedule pattern available for this route.</p>
      ) : (
        <div className={cn("space-y-6")}>
          {dirKeys.map((dir, di) => {
            const { variants } = directions[dir];
            const line = buildBranchedSnake(variants, OPTS);
            if (line.nodes.length === 0) return null;
            const trunkNodes = line.nodes.filter((n) => n.branch === 0);
            const trunkPoints = trunkNodes.map((n) => `${n.cx},${n.cy}`).join(" ");
            const first = trunkNodes[0];
            const last = trunkNodes[trunkNodes.length - 1];
            const trunkHead = variants[0]?.headsign;
            return (
              <div key={dir}>
                <h3 className={cn("mb-2 text-sm font-semibold text-at-muted")}>
                  {trunkHead ? `To ${trunkHead}` : `Direction ${di + 1}`}
                </h3>
                <svg
                  viewBox={`0 0 ${line.width} ${line.height}`}
                  role="img"
                  aria-label={trunkHead ? `Line to ${trunkHead}` : `Direction ${di + 1} line`}
                  className={cn("h-auto w-full")}
                  preserveAspectRatio="xMinYMid meet"
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
                  {line.edges
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
                  {line.nodes.map((n, idx) => {
                    const delay = delayByStop.get(n.stopId);
                    const name = nameByStop.get(n.stopId) ?? n.stopId;
                    const hasData = delay != null;
                    const label = hasData ? formatDelay(delay, { thresholdSec }) : null;
                    const terminus = n.branch === 0 && (n === first || n === last);
                    return (
                      <g key={`${n.branch}-${idx}`}>
                        {/* Delay time angled 45deg up-and-right; omitted when no data. */}
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
                        {/* White station, delay-coloured ring; termini read larger. */}
                        <circle
                          cx={n.cx}
                          cy={n.cy}
                          r={terminus ? 6.5 : 4.5}
                          strokeWidth={terminus ? 3.5 : 3}
                          className={cn("fill-at-surface", ringClass(delay, thresholdSec))}
                        >
                          <title>{`${name}${label ? ` · ${label}` : " · no data"}`}</title>
                        </circle>
                      </g>
                    );
                  })}
                  {/* Branch destinations. */}
                  {line.labels.map((l, i) => (
                    <text
                      key={`l${i}`}
                      x={l.cx}
                      y={l.cy}
                      dx={9}
                      dy={4}
                      textAnchor="start"
                      className={cn("fill-at-muted text-[10px] font-semibold")}
                    >
                      {l.headsign ?? "variant"}
                    </text>
                  ))}
                </svg>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
