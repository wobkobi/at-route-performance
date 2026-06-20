import { DiagramSvg, type DiagramNodeView } from "@/components/DiagramSvg";
import { cn } from "@/lib/cn";
import { buildBranchedSnake, type DiagramNode, type SnakeOpts } from "@/lib/route-graph";
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
  padBottom: 28,
  branchStep: 30,
  maxBranchStops: 6,
  minBranchStops: 3,
  labelReserve: 150,
  rightPad: 64,
};

/**
 * Resolve layout nodes to the client view shape (name + delay per stop).
 * @param nodes - Placed diagram nodes.
 * @param nameByStop - Stop id to display name.
 * @param delayByStop - Average delay per stop id.
 * @returns Nodes with resolved name and delay.
 */
function toViews(
  nodes: DiagramNode[],
  nameByStop: Map<string, string>,
  delayByStop: Map<string, number | null>,
): DiagramNodeView[] {
  return nodes.map((n) => ({
    stopId: n.stopId,
    cx: n.cx,
    cy: n.cy,
    branch: n.branch,
    name: nameByStop.get(n.stopId) ?? n.stopId,
    delay: delayByStop.get(n.stopId) ?? null,
  }));
}

/**
 * Per-direction stop diagram in the style of AT's rapid-transit map: a bold,
 * rounded trunk line that snake-wraps to stay on-screen, trip variants that end
 * differently forking off at 45deg, and white stations ringed by average delay.
 * Variants that share no origin with the trunk render as their own labelled
 * line. Every diagram is drawn at the same fixed scale; hovering a stop shows
 * its name and delay.
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

  // Lay out every diagram (main line per direction + disjoint sub-lines) up
  // front so they can share one viewBox width -> one scale, all filling the card.
  const blocks = dirKeys
    .map((dir, di) => {
      const { variants } = directions[dir];
      const main = buildBranchedSnake(variants, OPTS);
      const subs = main.separate
        .map((v) => ({ heading: v.headsign ?? "Variant", layout: buildBranchedSnake([v], OPTS) }))
        .filter((s) => s.layout.nodes.length > 0);
      return { dir, heading: variants[0]?.headsign ?? `Direction ${di + 1}`, main, subs };
    })
    .filter((b) => b.main.nodes.length > 0);

  const viewWidth = Math.max(
    1,
    ...blocks.flatMap((b) => [b.main.width, ...b.subs.map((s) => s.layout.width)]),
  );

  return (
    <section className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
      <h2 className={cn("mb-1 text-lg font-semibold")}>Line diagram</h2>
      <p className={cn("mb-3 text-xs text-at-muted")}>
        Stops in order per direction. Branches show where some trips end at different spots; each
        stop is ringed by its average delay. Hover a stop for its name.
      </p>
      {blocks.length === 0 ? (
        <p className={cn("text-sm text-at-muted")}>No schedule pattern available for this route.</p>
      ) : (
        <div className={cn("space-y-6")}>
          {blocks.map((b) => (
            <div key={b.dir} className={cn("space-y-4")}>
              <div>
                <h3 className={cn("mb-2 text-sm font-semibold text-at-muted")}>{b.heading}</h3>
                <DiagramSvg
                  nodes={toViews(b.main.nodes, nameByStop, delayByStop)}
                  edges={b.main.edges}
                  labels={b.main.labels}
                  viewWidth={viewWidth}
                  height={b.main.height}
                  thresholdSec={thresholdSec}
                  ariaLabel={b.heading}
                />
              </div>
              {b.subs.map((s, si) => (
                <div key={`s${si}`}>
                  <h4 className={cn("mb-1 text-xs font-semibold text-at-muted")}>{s.heading}</h4>
                  <DiagramSvg
                    nodes={toViews(s.layout.nodes, nameByStop, delayByStop)}
                    edges={s.layout.edges}
                    labels={s.layout.labels}
                    viewWidth={viewWidth}
                    height={s.layout.height}
                    thresholdSec={thresholdSec}
                    ariaLabel={s.heading}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
