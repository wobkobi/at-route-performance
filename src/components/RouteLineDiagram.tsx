"use client";
// src/components/RouteLineDiagram.tsx
// Build a route's stop graph layout and render it as a line diagram.
// Stops sharing a base name (same display name, or the same name once busway
// "Stop A/B" pole suffixes are stripped) collapse to one canonical node, so
// variants differing only by pole merge onto the trunk instead of spawning
// separate diagrams. Each direction is laid out as a snake, box loop, or
// triangle, with disjoint variants becoming their own labelled sub-lines; all
// panels share one viewBox width for a consistent scale. Tiny routes drop the
// SVG for a 2-column grid or a flat stop table, and directions with no data yet
// render a "coming soon" placeholder.

import { DiagramSvg, type DiagramNodeView } from "@/components/DiagramSvg";
import { delayColour } from "@/lib/delay-colour";
import {
  buildBoxLoop,
  buildBranchedSnake,
  buildTriangle,
  detectTriangle,
  isLoopVariant,
  type BranchedSnake,
  type DiagramNode,
  type SnakeOpts,
} from "@/lib/route-graph";
import type { RoutePattern, RouteVariant } from "@/types/api";
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
  /** Stop IDs named in an active service alert; those nodes get a dashed disruption ring. */
  alertStopIds?: Set<string>;
  /** True when there is an active DETOUR alert for this route - dashes the SVG route lines. */
  hasDetour?: boolean;
}

/** Every diagram of a route laid out at one column cap. */
interface DiagramSet {
  /** Each direction's main line and its disjoint sub-lines. */
  blocks: {
    dir: number;
    heading: string;
    main: BranchedSnake;
    subs: { heading: string; layout: BranchedSnake }[];
  }[];
  /** The widest layout, shared as every diagram's viewBox width. */
  viewWidth: number;
  /** Mains and subs flattened in order, for the grid of short lines. */
  panels: { key: string; heading: string; layout: BranchedSnake }[];
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

/**
 * Stops per row below sm. Six 52px columns plus their labels come to about
 * 330px, the width of the card on a phone, so the diagram draws near 1:1
 * rather than a 20-column line squeezed to a third of its size.
 */
const PHONE_COLS = 6;

/** Narrowest viewBox on a phone: the card's width there, so a short line is not blown up past 1:1. */
const PHONE_VIEW_WIDTH = 330;
/** Narrowest viewBox from sm up, shared so every route draws at one scale. */
const WIDE_VIEW_WIDTH = 1040;
/** Narrowest viewBox for a panel in the two-column grid of short lines. */
const GRID_VIEW_WIDTH = 520;

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
  return BUSWAY_STOP_RE.exec(name)?.[1] ?? name;
}

/**
 * Compute columns per row so the last row is as full as the others.
 * Divides `stopCount` into the minimum number of rows that fit within
 * `maxCols`, then evenly distributes stops across those rows.
 * @param stopCount - Number of stops in the trunk or sub-variant.
 * @param maxCols - Most stops a row may hold.
 * @returns Columns per row (at least 5, or `maxCols` when that is fewer).
 */
function dynamicCols(stopCount: number, maxCols: number): number {
  const numRows = Math.ceil(stopCount / maxCols);
  return Math.max(Math.min(5, maxCols), Math.ceil(stopCount / numRows));
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
 * line. Every diagram is drawn at the same fixed scale; hovering, tapping or focusing a stop shows
 * its name and delay.
 * @param props - Diagram props.
 * @param props.directions - Stopping patterns grouped by direction.
 * @param props.delayByStop - Average delay per stop id.
 * @param props.nameByStop - Stop id to display name.
 * @param props.mode - Route mode (drives the early/late colour banding).
 * @param props.alertStopIds - Stop ids with active alerts (drawn with a warning badge).
 * @param props.hasDetour - When true, dashes the route lines to indicate a detour.
 * @returns The diagram element, or an empty note when no pattern is available.
 */
export function RouteLineDiagram({
  directions,
  delayByStop,
  nameByStop,
  mode,
  alertStopIds,
  hasDetour,
}: RouteLineDiagramProps): JSX.Element {
  // Direction keys in numeric order, each paired with its variants. Resolved
  // once here so nothing below indexes `directions` by a possibly-missing key.
  const dirs = Object.keys(directions)
    .map(Number)
    .sort((a, b) => a - b)
    .map((dir) => ({ dir, variants: directions[dir]?.variants ?? [] }));

  /**
   * True when at least one arrival event was recorded for the direction today;
   * directions with none are shown as a "coming soon" placeholder below.
   * @param variants - The direction's stopping patterns.
   * @returns True when `delayByStop` contains any stop in the direction.
   */
  const hasData = (variants: RouteVariant[]): boolean =>
    variants.some((v) => v.stopIds.some((id) => delayByStop.has(id)));

  const dataDirs = dirs.filter((d) => hasData(d.variants));
  const emptyDirs = dirs.filter((d) => !hasData(d.variants));

  // Headings for directions with no data yet (parallel to emptyDirs): the
  // busiest variant's headsign (first wins a tie), or a numbered fallback.
  const emptyHeadings = emptyDirs.map(({ variants }, i) => {
    let busiest: RouteVariant | undefined;
    for (const v of variants) if (!busiest || v.tripCount > busiest.tripCount) busiest = v;
    return busiest?.headsign ?? `Direction ${i + 1}`;
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

  /**
   * Lay out every diagram (main line per direction + disjoint sub-lines) at one
   * column cap, up front, so they can share one viewBox width and one scale.
   * @param maxCols - Most stops a row may hold.
   * @returns The blocks, their shared width, and the flat panel list.
   */
  const layoutAt = (maxCols: number): DiagramSet => {
    const blocks = dataDirs
      .map(({ dir, variants }, di) => {
        const trunkLen = variants[0]?.stopIds.length ?? 1;
        const mainOpts = { ...OPTS, cols: dynamicCols(trunkLen, maxCols) };
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
            const subOpts = { ...OPTS, cols: dynamicCols(v.stopIds.length, maxCols) };
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
    return { blocks, viewWidth, panels };
  };

  const wide = layoutAt(MAX_COLS);
  const phone = layoutAt(PHONE_COLS);
  // Which shape to draw depends on stop counts alone, so both layouts agree on it.
  const { blocks, panels } = wide;
  const allPanelsSmall = panels.every((p) => p.layout.nodes.length <= TABLE_THRESHOLD);
  // Multiple small panels: a grid of SVGs (two columns from sm up). Require no
  // subs so merged directions that produce sub-diagrams fall through to the
  // normal nested rendering.
  const useGrid = allPanelsSmall && panels.length >= 2 && blocks.every((b) => b.subs.length === 0);
  // Single tiny panel: stop table instead of a SVG with only 2-3 stops. Holding
  // the panel itself (rather than a boolean) lets the JSX below narrow on it.
  const singlePanel = allPanelsSmall && panels.length === 1 ? panels[0] : undefined;

  /**
   * One heading and its diagram.
   * @param key - React key.
   * @param heading - The line's name, shown above it and read as its label.
   * @param layout - The laid-out line.
   * @param viewWidth - Shared viewBox width.
   * @param minViewWidth - Narrowest viewBox the diagram may take.
   * @returns The panel.
   */
  const panel = (
    key: string,
    heading: string,
    layout: BranchedSnake,
    viewWidth: number,
    minViewWidth: number,
  ): JSX.Element => (
    <div key={key} className="space-y-2">
      <p className="text-center text-lg font-ultra tracking-zero text-at-ink">{heading}</p>
      <DiagramSvg
        nodes={toViews(layout.nodes, nameByStop, delayByStop)}
        edges={layout.edges}
        labels={layout.labels}
        viewWidth={viewWidth}
        height={layout.height}
        minViewWidth={minViewWidth}
        mode={mode}
        closed={layout.closed}
        ariaLabel={heading}
        alertStopIds={alertStopIds}
        hasDetour={hasDetour}
      />
    </div>
  );

  /**
   * Every diagram at one layout: the grid of small panels, or each direction
   * with its sub-lines beneath it.
   * @param set - The layout to draw.
   * @param onPhone - Whether this is the phone layout.
   * @returns The diagrams.
   */
  const diagrams = (set: DiagramSet, onPhone: boolean): JSX.Element =>
    useGrid ? (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {set.panels.map((p) =>
          panel(p.key, p.heading, p.layout, 0, onPhone ? PHONE_VIEW_WIDTH : GRID_VIEW_WIDTH),
        )}
      </div>
    ) : (
      <div className="space-y-6">
        {set.blocks.map((b) => (
          <div key={b.dir} className="space-y-2">
            {panel(
              "main",
              b.heading,
              b.main,
              set.viewWidth,
              onPhone ? PHONE_VIEW_WIDTH : WIDE_VIEW_WIDTH,
            )}
            {b.subs.map((s, si) =>
              panel(
                `s${si}`,
                s.heading,
                s.layout,
                set.viewWidth,
                onPhone ? PHONE_VIEW_WIDTH : WIDE_VIEW_WIDTH,
              ),
            )}
          </div>
        ))}
      </div>
    );

  return (
    <section className="border border-at-border bg-at-surface p-4">
      <h2 className="mb-1 text-lg font-ultra tracking-zero">Line diagram</h2>
      {!singlePanel && blocks.length > 0 && (
        <p className="mb-3 text-xs text-at-muted">
          Hover or tap a stop for its name, or tab in and step along with the arrow keys.
        </p>
      )}
      {blocks.length === 0 && emptyDirs.length === 0 ? (
        <p className="text-sm text-at-muted">No schedule pattern available for this route.</p>
      ) : singlePanel ? (
        <div className="space-y-2">
          <p className="text-center text-lg font-ultra tracking-zero text-at-ink">
            {singlePanel.heading}
          </p>
          <StopTable
            nodes={singlePanel.layout.nodes}
            nameByStop={nameByStop}
            delayByStop={delayByStop}
            mode={mode}
          />
        </div>
      ) : (
        // Both layouts are rendered and CSS shows one, so the server's HTML is
        // already right for the width and nothing re-lays out on hydration. The
        // hidden copy is display:none, so it is out of the tab order and the
        // accessibility tree.
        <>
          <div className="sm:hidden">{diagrams(phone, true)}</div>
          <div className="hidden sm:block">{diagrams(wide, false)}</div>
        </>
      )}
      {emptyDirs.map(({ dir }, i) => (
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
