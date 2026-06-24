"use client";

import { DiagramSvg, type DiagramNodeView } from "@/components/DiagramSvg";
import { delayColour } from "@/lib/delay-colour";
import {
  buildBoxLoop,
  buildBranchedSnake,
  buildTriangle,
  detectTriangle,
  isLoopVariant,
  type DiagramNode,
  type SnakeOpts,
} from "@/lib/route-graph";
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
  /** Route mode, for the per-mode on-time colour banding. */
  mode: string;
  /** Stop id currently focused on the map (emphasised in the diagram). */
  selectedStopId?: string;
  /** Called with a stop id when its node is clicked, to focus it on the map. */
  onSelectStop?: (stopId: string) => void;
  /** Stop IDs named in an active service alert; those nodes get a dashed disruption ring. */
  alertStopIds?: Set<string>;
  /** True when there is an active DETOUR alert for this route - dashes the SVG route lines. */
  hasDetour?: boolean;
}

/** Routes with at most this many trunk nodes get a stop table instead of the SVG. */
const TABLE_THRESHOLD = 6;

/**
 * Flat grid of stops with a coloured delay dot - used instead of the SVG diagram
 * when the trunk is short enough that the SVG would render tiny.
 * @param props - Component props.
 * @param props.nodes - Ordered diagram nodes (trunk only).
 * @param props.nameByStop - Stop id to display name.
 * @param props.delayByStop - Average delay per stop id.
 * @param props.mode - Route mode (drives the on-time colour band).
 * @returns The stop table element.
 */
function StopTable({
  nodes,
  nameByStop,
  delayByStop,
  mode,
}: {
  nodes: DiagramNode[];
  nameByStop: Map<string, string>;
  delayByStop: Map<string, number | null>;
  mode: string;
}): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-px bg-at-border">
      {nodes.map((n) => {
        const delay = delayByStop.get(n.stopId) ?? null;
        const colour = delayColour(delay, mode);
        const name = nameByStop.get(n.stopId) ?? n.stopId;
        return (
          <div key={n.stopId} className="flex items-center gap-2 bg-at-surface px-3 py-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full border-2"
              style={{ borderColor: colour }}
            />
            <span className="truncate text-sm text-at-ink">{name}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Metro-style layout geometry (pixels). Labels sit horizontally above/below the
 * line (alternating), so `row` leaves a band on each side of a row for them and
 * `padTop`/`padBottom` keep the outermost rows' labels on-canvas.
 */
/** Maximum stops per row (hard cap). */
const MAX_COLS = 20;

const OPTS: SnakeOpts = {
  cols: MAX_COLS,
  col: 52,
  row: 80,
  padX: 20,
  padTop: 80,
  padBottom: 72,
  branchDrop: 62,
  maxBranchStops: 6,
  minBranchStops: 3,
  labelReserve: 140,
  rightPad: 30,
};

/** Busway stop-letter suffix: "Albany Station Stop A" > "Albany Station". */
const BUSWAY_STOP_RE = /^(.*?)\s+Stop\s+[A-Z]{1,2}$/i;

/**
 * Strip a busway stop-letter suffix so different physical poles at the same
 * station compare equal in prefix/suffix matching.
 * @param name - Stop display name.
 * @returns Base name without the suffix, or the original name when none matches.
 */
function busStopBase(name: string): string {
  const m = BUSWAY_STOP_RE.exec(name);
  return m ? m[1] : name;
}

/**
 * Compute columns per row so the last row is as full as the others.
 * Divides `stopCount` into the minimum number of rows that fit within
 * `MAX_COLS`, then evenly distributes stops across those rows.
 * @param stopCount - Number of stops in the trunk or sub-variant.
 * @returns Columns per row (at least 5).
 */
function dynamicCols(stopCount: number): number {
  const numRows = Math.ceil(stopCount / MAX_COLS);
  return Math.max(5, Math.ceil(stopCount / numRows));
}

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
    labelDir: n.labelDir,
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
 * @param props.mode - Route mode (drives the early/late colour banding).
 * @param props.selectedStopId - Stop id focused on the map (emphasised here).
 * @param props.onSelectStop - Called with a stop id when its node is clicked.
 * @param props.alertStopIds - Stop ids with active alerts (drawn with a warning badge).
 * @param props.hasDetour - When true, dashes the route lines to indicate a detour.
 * @returns The diagram element, or an empty note when no pattern is available.
 */
export function RouteLineDiagram({
  directions,
  delayByStop,
  nameByStop,
  mode,
  selectedStopId,
  onSelectStop,
  alertStopIds,
  hasDetour,
}: RouteLineDiagramProps): JSX.Element {
  const dirKeys = Object.keys(directions)
    .map(Number)
    .sort((a, b) => a - b);

  // A direction has data if at least one of its scheduled stops appears in
  // delayByStop (meaning at least one arrival event was recorded for it today).
  // Directions with no observed trips yet are shown as a "coming soon" placeholder.
  /**
   * True when at least one arrival event was recorded for the direction today.
   * @param dir - Direction key.
   * @returns True when `delayByStop` contains any stop in the direction.
   */
  const dirHasData = (dir: number): boolean =>
    directions[dir].variants.some((v) => v.stopIds.some((id) => delayByStop.has(id)));

  const dataKeys = dirKeys.filter(dirHasData);
  const emptyKeys = dirKeys.filter((d) => !dirHasData(d));

  // Headings for directions with no data yet (parallel to emptyKeys).
  const emptyHeadings = emptyKeys.map((dir) => {
    const { variants } = directions[dir];
    const busiest = variants.reduce((a, b) => (b.tripCount > a.tripCount ? b : a), variants[0]);
    return busiest?.headsign ?? `Direction ${emptyKeys.indexOf(dir) + 1}`;
  });

  // Collapse stop IDs that share the same base name to a canonical ID: same
  // display name OR same name once busway stop-letter suffixes are stripped
  // ("Stop A", "Stop B"). Different physical poles at the same intersection
  // compare equal, so variants that only differ in which pole they use merge
  // onto the trunk rather than appearing as separate diagrams.
  const baseToFirst = new Map<string, string>();
  for (const [stopId, name] of nameByStop) {
    const base = busStopBase(name);
    if (!baseToFirst.has(base)) baseToFirst.set(base, stopId);
  }
  /**
   * Map a stop id to the canonical id for its base name, collapsing same-named
   * poles and busway stop-letter variants to one node in prefix/suffix matching.
   * @param stopId - The stop's real id.
   * @returns The canonical id for that base name, or `stopId` when not in the map.
   */
  const canonId = (stopId: string): string => {
    const name = nameByStop.get(stopId);
    if (name == null) return stopId;
    return baseToFirst.get(busStopBase(name)) ?? stopId;
  };

  // Lay out every diagram (main line per direction + disjoint sub-lines) up
  // front so they can share one viewBox width > one scale, all filling the card.
  const blocks = dataKeys
    .map((dir, di) => {
      const { variants } = directions[dir];
      const trunkLen = variants[0]?.stopIds.length ?? 1;
      const mainOpts = { ...OPTS, cols: dynamicCols(trunkLen) };
      // A route that returns to its start draws as a closed box loop.
      // Triangle: two variants sharing the same terminals (e.g. direct + Via X).
      const tri = detectTriangle(variants);
      if (tri) {
        const [direct, via] = tri;
        const main = buildTriangle(direct, via, mainOpts);
        return { dir, heading: main.trunkHeadsign ?? `Direction ${di + 1}`, main, subs: [] };
      }
      const main =
        variants[0] && isLoopVariant(variants[0])
          ? buildBoxLoop(variants[0], mainOpts)
          : buildBranchedSnake(variants, mainOpts, canonId);
      const subs = main.separate
        .map((v) => {
          const subOpts = { ...OPTS, cols: dynamicCols(v.stopIds.length) };
          return { heading: v.headsign ?? "Variant", layout: buildBranchedSnake([v], subOpts) };
        })
        .filter((s) => s.layout.nodes.length > 0);
      // Heading names the trunk actually drawn (the fullest run), not just the
      // first listed variant, so it matches the spine on screen.
      return { dir, heading: main.trunkHeadsign ?? `Direction ${di + 1}`, main, subs };
    })
    .filter((b) => b.main.nodes.length > 0);

  const viewWidth = Math.max(
    1,
    ...blocks.flatMap((b) => [b.main.width, ...b.subs.map((s) => s.layout.width)]),
  );

  // Flatten mains + subs into a single ordered panel list so grids work
  // regardless of whether the GTFS uses 4 direction_ids or 2 directions with
  // sub-variants for the Via X services.
  const panels = blocks.flatMap((b) => [
    { key: String(b.dir), heading: b.heading, layout: b.main },
    ...b.subs.map((s, si) => ({ key: `${b.dir}_${si}`, heading: s.heading, layout: s.layout })),
  ]);
  const allPanelsSmall = panels.every((p) => p.layout.nodes.length <= TABLE_THRESHOLD);
  // Multiple small panels: 2-column grid of SVGs. Require no subs so merged
  // directions that produce sub-diagrams fall through to the normal nested rendering.
  const useGrid = allPanelsSmall && panels.length >= 2 && blocks.every((b) => b.subs.length === 0);
  // Single tiny panel: stop table instead of a SVG with only 2-3 stops.
  const useSingleTable = allPanelsSmall && panels.length === 1;

  return (
    <section className="border border-at-border bg-at-surface p-4">
      <h2 className="mb-1 text-lg font-ultra tracking-zero">Line diagram</h2>
      {!useSingleTable && blocks.length > 0 && (
        <p className="mb-3 text-xs text-at-muted">Hover a stop for its name.</p>
      )}
      {blocks.length === 0 && emptyKeys.length === 0 ? (
        <p className="text-sm text-at-muted">No schedule pattern available for this route.</p>
      ) : useGrid ? (
        <div className="grid grid-cols-2 gap-4">
          {panels.map((p) => (
            <div key={p.key} className="space-y-2">
              <p className="text-center text-lg font-ultra tracking-zero text-at-ink">
                {p.heading}
              </p>
              <DiagramSvg
                nodes={toViews(p.layout.nodes, nameByStop, delayByStop)}
                edges={p.layout.edges}
                labels={p.layout.labels}
                viewWidth={0}
                height={p.layout.height}
                minViewWidth={520}
                mode={mode}
                closed={p.layout.closed}
                ariaLabel={p.heading}
                selectedStopId={selectedStopId}
                onSelectStop={onSelectStop}
                alertStopIds={alertStopIds}
                hasDetour={hasDetour}
              />
            </div>
          ))}
        </div>
      ) : useSingleTable ? (
        <div className="space-y-2">
          <p className="text-center text-lg font-ultra tracking-zero text-at-ink">
            {panels[0].heading}
          </p>
          <StopTable
            nodes={panels[0].layout.nodes}
            nameByStop={nameByStop}
            delayByStop={delayByStop}
            mode={mode}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {blocks.map((b) => (
            <div key={b.dir} className="space-y-2">
              <p className="text-center text-lg font-ultra tracking-zero text-at-ink">
                {b.heading}
              </p>
              <DiagramSvg
                nodes={toViews(b.main.nodes, nameByStop, delayByStop)}
                edges={b.main.edges}
                labels={b.main.labels}
                viewWidth={viewWidth}
                height={b.main.height}
                mode={mode}
                closed={b.main.closed}
                ariaLabel={b.heading}
                selectedStopId={selectedStopId}
                onSelectStop={onSelectStop}
                alertStopIds={alertStopIds}
                hasDetour={hasDetour}
              />
              {b.subs.map((s, si) => (
                <div key={`s${si}`} className="space-y-2">
                  <p className="text-center text-lg font-ultra tracking-zero text-at-ink">
                    {s.heading}
                  </p>
                  <DiagramSvg
                    nodes={toViews(s.layout.nodes, nameByStop, delayByStop)}
                    edges={s.layout.edges}
                    labels={s.layout.labels}
                    viewWidth={viewWidth}
                    height={s.layout.height}
                    mode={mode}
                    closed={s.layout.closed}
                    ariaLabel={s.heading}
                    selectedStopId={selectedStopId}
                    onSelectStop={onSelectStop}
                    alertStopIds={alertStopIds}
                    hasDetour={hasDetour}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {emptyKeys.map((dir, i) => (
        <div key={`empty-${dir}`} className="mt-4 space-y-2">
          <p className="text-center text-lg font-ultra tracking-zero text-at-ink">
            {emptyHeadings[i]}
          </p>
          <p className="py-4 text-center text-sm text-at-muted">
            No trips observed yet - this direction will appear once data comes in.
          </p>
        </div>
      ))}
    </section>
  );
}
