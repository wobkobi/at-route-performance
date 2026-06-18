import { cn } from "@/lib/cn";
import { formatDelay } from "@/lib/format";
import { buildBranchedLine } from "@/lib/route-graph";
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

const COL = 26; // px between columns
const ROW = 34; // px between tracks
const PAD = 22; // px padding around the grid
const R = 5; // node radius

/**
 * Tailwind `fill-*` utility for a stop node, by its average delay.
 * @param delay - Average delay in seconds, or null when unknown.
 * @param thresholdSec - Threshold for late/early banding.
 * @returns A fill utility class.
 */
function fillFor(delay: number | null | undefined, thresholdSec: number): string {
  if (delay == null) return "fill-at-border";
  if (delay > thresholdSec) return "fill-at-late";
  if (delay < -thresholdSec) return "fill-at-early";
  return "fill-at-ontime";
}

/**
 * Branching, metro-style diagram of a route's stops per direction, with forks
 * where trip variants diverge. Each stop node is coloured by its average delay.
 * Server-rendered SVG; long routes scroll horizontally.
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

  if (dirKeys.length === 0) {
    return (
      <section className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
        <h2 className={cn("mb-1 text-lg font-semibold")}>Line diagram</h2>
        <p className={cn("text-sm text-at-muted")}>No schedule pattern available for this route.</p>
      </section>
    );
  }

  return (
    <section className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
      <h2 className={cn("mb-1 text-lg font-semibold")}>Line diagram</h2>
      <p className={cn("mb-3 text-xs text-at-muted")}>
        Stops in order per direction, coloured by average delay. Forks show trip variants.
      </p>
      <div className={cn("space-y-6")}>
        {dirKeys.map((dir, di) => {
          const { variants } = directions[dir];
          const line = buildBranchedLine(variants);
          if (line.nodes.length === 0) return null;
          const w = PAD * 2 + Math.max(0, line.width - 1) * COL;
          const h = PAD * 2 + Math.max(0, line.height - 1) * ROW;
          const trunkHead = variants[0]?.headsign;
          return (
            <div key={dir}>
              <h3 className={cn("mb-2 text-sm font-semibold text-at-muted")}>
                {trunkHead ? `To ${trunkHead}` : `Direction ${di + 1}`}
              </h3>
              <div className={cn("overflow-x-auto")}>
                <svg
                  width={w}
                  height={h}
                  viewBox={`0 0 ${w} ${h}`}
                  role="img"
                  aria-label={`Stop diagram, ${trunkHead ? `to ${trunkHead}` : `direction ${di + 1}`}`}
                >
                  {line.edges.map((e, i) => (
                    <line
                      key={`e${i}`}
                      x1={PAD + e.x1 * COL}
                      y1={PAD + e.y1 * ROW}
                      x2={PAD + e.x2 * COL}
                      y2={PAD + e.y2 * ROW}
                      strokeWidth={e.branch ? 2 : 3}
                      className={cn(e.branch ? "stroke-at-muted" : "stroke-at-shore")}
                    />
                  ))}
                  {line.labels.map((l, i) => (
                    <text
                      key={`l${i}`}
                      x={PAD + l.x * COL}
                      y={PAD + l.y * ROW - 8}
                      className={cn("fill-at-muted text-[10px]")}
                    >
                      {l.headsign ?? "variant"}
                    </text>
                  ))}
                  {line.nodes.map((n) => {
                    const delay = delayByStop.get(n.stopId);
                    const name = nameByStop.get(n.stopId) ?? n.stopId;
                    const label = delay == null ? "no data" : formatDelay(delay, { thresholdSec });
                    return (
                      <circle
                        key={n.stopId}
                        cx={PAD + n.x * COL}
                        cy={PAD + n.y * ROW}
                        r={R}
                        strokeWidth={2}
                        className={cn("stroke-at-ink", fillFor(delay, thresholdSec))}
                      >
                        <title>{`${name} · ${label}`}</title>
                      </circle>
                    );
                  })}
                </svg>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
