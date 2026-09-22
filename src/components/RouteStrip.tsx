"use client";
// src/components/RouteStrip.tsx
// The route diagram as a strip map: one line down the page carrying both directions, each stop a
// ring split between them, with its name and a figure column per direction beside it. The line
// and rings are one svg behind each column, drawn 1:1 from lib/route-strip.ts; the names and
// figures are the rows of a list on the same 32px pitch, so CSS wraps or cuts a name to fit and
// the figure columns size to their widest figure.

import { brandColour } from "@/components/ModeIcon";
import { cn } from "@/lib/cn";
import {
  layoutStrip,
  pickBreaks,
  STRIP_LANE,
  STRIP_ROW,
  type StripColumn,
  type RouteStrip as StripData,
  type StripSide,
} from "@/lib/route-strip";
import type { StopSplit } from "@/lib/stop-split";
import { stripView, type HalfTone, type StripView } from "@/lib/strip-view";
import { useMemo, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from "react";

/** Where a column's drawing sits: the first ring centred in the first row, the line in from the left. */
const DIMS = { top: STRIP_ROW / 2, left: 16, tail: 10 };
/** Ring radius, for a stop and for a terminus (px). */
const RING_R = 7;
const TERMINUS_R = 9;
/** Ring and line stroke widths (px). */
const RING_W = 4;
const LINE_W = 6;
/** Gap from the outermost track to the names (px). */
const NAME_GAP = 18;
/** A strip shorter than this stays one column on a wide screen, since two would be stubs. */
const WIDE_MIN_ROWS = 16;

/** Stroke class for each half-ring tone. */
const HALF_STROKE: Record<HalfTone, string> = {
  late: "stroke-at-late",
  early: "stroke-at-early",
  ontime: "stroke-at-ontime",
  none: "stroke-at-border",
  unserved: "stroke-at-muted/60",
};
/** Text class for each figure tone: only the stops off time stand out. */
const FIGURE_TEXT: Record<HalfTone, string> = {
  late: "font-semibold text-at-late",
  early: "font-semibold text-at-early-strong",
  ontime: "text-at-muted",
  none: "text-at-muted",
  unserved: "text-at-muted",
};
/** One direction picked: the other direction's half of every ring, heading and figure recedes. */
const DIM_HALF = {
  down: "group-data-[dir=up]/strip:stroke-at-border group-data-[dir=up]/strip:[stroke-dasharray:none]",
  up: "group-data-[dir=down]/strip:stroke-at-border group-data-[dir=down]/strip:[stroke-dasharray:none]",
};
const DIM_TEXT = {
  down: "group-data-[dir=up]/strip:text-at-muted/50",
  up: "group-data-[dir=down]/strip:text-at-muted/50",
};

/**
 * A stop name with a line break allowed after each slash, so "Road/Street" names wrap there on a
 * phone rather than mid-word.
 * @param name - The stop's name.
 * @returns The name, with a `wbr` after each slash.
 */
function breakable(name: string): ReactNode {
  return name.split("/").flatMap((part, i) => (i === 0 ? [part] : ["/", <wbr key={i} />, part]));
}

/**
 * A column heading as it reads mid-sentence: "To the start" > "to the start", "Clockwise" >
 * "clockwise". Only the first letter changes, so a stop's name keeps its capitals.
 * @param heading - The heading.
 * @returns It with a lower-case first letter.
 */
function midSentence(heading: string): string {
  return heading.charAt(0).toLowerCase() + heading.slice(1);
}

/** Props for {@link RouteStrip}. */
export interface RouteStripProps {
  /** The route laid out as one strip, from `buildStrip`. */
  strip: StripData;
  /** The day's figures per stop, direction and version, or null where there are none (the week). */
  split: StopSplit | null;
  /** The route's mode, for its on-time window. */
  mode: string;
  /** The route's GTFS colour (hex, no hash), or null for the site's blue. */
  colour: string | null;
  /** The side the page's direction chip picked, or null for both. */
  side: StripSide | null;
  /** Keys of the rows a live service alert names. */
  alertRows: string[];
}

/**
 * The route diagram: version chips, the strip laid out once as a single column and once as two
 * (switched by CSS, so the server HTML is right for the width and nothing re-lays out on
 * hydration), the key, and the minor versions listed underneath. The page's direction chip dims
 * the other direction through `data-dir`, so nothing is redrawn and no stop moves; a version chip
 * swaps in that version's figures and greys out what it doesn't use.
 * @param props - See {@link RouteStripProps}.
 * @param props.strip - The strip.
 * @param props.split - The day's figures, or null.
 * @param props.mode - The route's mode.
 * @param props.colour - The route's colour.
 * @param props.side - The direction picked.
 * @param props.alertRows - Rows named in an alert.
 * @returns The diagram section.
 */
export function RouteStrip({
  strip,
  split,
  mode,
  colour,
  side,
  alertRows,
}: RouteStripProps): JSX.Element {
  const [version, setVersion] = useState<string | null>(null);
  // The one row in the tab order (roving tabindex), so a 60-stop route is one tab stop.
  const [active, setActive] = useState(0);
  const refs = useRef<Record<"one" | "two", Array<HTMLLIElement | null>>>({ one: [], two: [] });

  const view = useMemo(
    () => stripView({ strip, split, version, mode }),
    [strip, split, version, mode],
  );
  const layouts = useMemo(() => {
    const breaks = strip.rows.length >= WIDE_MIN_ROWS ? pickBreaks(strip, 2) : [];
    return {
      one: layoutStrip(strip, [], DIMS),
      two: breaks.length > 0 ? layoutStrip(strip, breaks, DIMS) : null,
    };
  }, [strip]);
  const alerts = useMemo(() => new Set(alertRows), [alertRows]);

  if (strip.rows.length === 0) {
    return (
      <section className="border border-at-border bg-at-surface p-4">
        <h2 className="text-lg font-ultra tracking-zero">Line diagram</h2>
        <p className="mt-2 text-sm text-at-muted">
          No stopping pattern yet. The diagram fills in once this route records a full run.
        </p>
      </section>
    );
  }

  const chips = strip.versions.filter((v) => !v.minor);
  const minor = strip.versions.filter((v) => v.minor);
  const twoWay = strip.down.length > 0 && strip.up.length > 0;
  const nameX = DIMS.left + Math.max(0, ...strip.rows.map((r) => r.reach)) * STRIP_LANE + NAME_GAP;
  const hasAlert = strip.rows.some((r) => alerts.has(r.key));

  /**
   * Step along the rows from the keyboard: the arrows move one stop, Home and End to either end.
   * @param e - The key event.
   * @param layout - Which copy of the strip has focus.
   * @param i - The focused row.
   */
  const onKey = (e: KeyboardEvent<HTMLLIElement>, layout: "one" | "two", i: number): void => {
    const last = strip.rows.length - 1;
    const to =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? Math.min(i + 1, last)
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? Math.max(i - 1, 0)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (to == null) return;
    e.preventDefault();
    refs.current[layout][to]?.focus();
  };

  /**
   * One copy of the strip, in its columns.
   * @param layout - Which copy.
   * @param columns - Its columns.
   * @returns The columns.
   */
  const copy = (layout: "one" | "two", columns: StripColumn[]): JSX.Element[] =>
    columns.map((col) => (
      <Column
        key={col.rows[0]?.index ?? 0}
        col={col}
        view={view}
        strip={strip}
        version={version}
        twoWay={twoWay}
        figures={split != null}
        nameX={nameX}
        colour={colour}
        alerts={alerts}
        active={active}
        setRef={(i, el) => {
          refs.current[layout][i] = el;
        }}
        onFocusRow={setActive}
        onKey={(e, i) => onKey(e, layout, i)}
      />
    ));

  return (
    <section className="border border-at-border bg-at-surface p-4">
      <h2 className="mb-3 text-lg font-ultra tracking-zero">Line diagram</h2>
      {chips.length > 1 && (
        <div role="group" aria-label="Version" className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-at-muted">Version</span>
          <button
            type="button"
            aria-pressed={version == null}
            onClick={() => setVersion(null)}
            className={cn("chip", version == null ? "chip-on" : "chip-off")}
          >
            {chips.length === 2 ? "Both" : "All"}
          </button>
          {chips.map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={version === v.key}
              onClick={() => setVersion(v.key)}
              className={cn("chip", version === v.key ? "chip-on" : "chip-off")}
            >
              {v.from} to {v.to}
            </button>
          ))}
        </div>
      )}
      {!split && (
        <p className="mb-3 text-xs text-at-muted">
          Figures per stop are kept for a single day, so the week draws the line without them.
        </p>
      )}
      <div data-dir={side ?? undefined} className="group/strip">
        <div className={cn("max-w-2xl", layouts.two && "lg:hidden")}>
          {copy("one", layouts.one)}
        </div>
        {layouts.two && (
          <div className="hidden gap-x-10 lg:grid lg:grid-cols-2">{copy("two", layouts.two)}</div>
        )}
        <StripKey
          view={view}
          twoWay={twoWay}
          perStop={split != null}
          alert={hasAlert}
          colour={colour}
        />
      </div>
      {minor.length > 0 && (
        <p className="mt-3 border-t border-at-border pt-2 text-xs text-at-muted">
          <span className="font-semibold text-at-ink">Also runs, on a few trips:</span>{" "}
          {minor.map((v) => `${v.from} to ${v.to}`).join(" · ")}
        </p>
      )}
    </section>
  );
}

/**
 * One column of the strip: the figure columns' headings, then the rows, with the line and rings
 * drawn behind them. Without figures (the week) it is the names alone, since columns of dashes
 * would only crowd them.
 * @param props - Props.
 * @param props.col - The column's layout.
 * @param props.view - What every row shows.
 * @param props.strip - The strip, for each piece's versions.
 * @param props.version - The picked version, or null.
 * @param props.twoWay - Whether the route runs both ways.
 * @param props.figures - Whether there are figures per stop to show.
 * @param props.nameX - Where the names start (px).
 * @param props.colour - The route's colour.
 * @param props.alerts - Keys of the rows an alert names.
 * @param props.active - The row in the tab order.
 * @param props.setRef - Keeps each row's element, for moving focus.
 * @param props.onFocusRow - Makes a focused row the one in the tab order.
 * @param props.onKey - Steps along the rows.
 * @returns The column.
 */
function Column({
  col,
  view,
  strip,
  version,
  twoWay,
  figures,
  nameX,
  colour,
  alerts,
  active,
  setRef,
  onFocusRow,
  onKey,
}: {
  col: StripColumn;
  view: StripView;
  strip: StripData;
  version: string | null;
  twoWay: boolean;
  figures: boolean;
  nameX: number;
  colour: string | null;
  alerts: ReadonlySet<string>;
  active: number;
  setRef: (i: number, el: HTMLLIElement | null) => void;
  onFocusRow: (i: number) => void;
  onKey: (e: KeyboardEvent<HTMLLIElement>, i: number) => void;
}): JSX.Element {
  const lineHex = brandColour(colour);
  const rowsH = col.rows.length * STRIP_ROW;
  const drawH = Math.max(rowsH, col.bottom + TERMINUS_R + RING_W);
  // Pieces off the picked version go first, so the line it runs along is drawn over their ends.
  const pieces = [...col.pieces].sort(
    (a, b) =>
      Number(version == null || a.versions.includes(version)) -
      Number(version == null || b.versions.includes(version)),
  );
  return (
    <div
      className={cn(
        // content-start: a column shorter than its neighbour keeps its rows at the top, level
        // with the neighbour's, rather than spreading the extra height between them.
        "grid content-start gap-x-2 sm:gap-x-3",
        !figures
          ? "grid-cols-1"
          : twoWay
            ? "grid-cols-[minmax(0,1fr)_auto_auto]"
            : "grid-cols-[minmax(0,1fr)_auto]",
      )}
    >
      {figures && (
        <div
          aria-hidden="true"
          className="col-span-full grid grid-cols-subgrid items-end border-b border-at-border pb-1.5 text-xs font-semibold text-at-muted"
        >
          <span />
          {/* w-min: a heading widens its column only to its longest word, and wraps within it. */}
          <span className={cn("w-min min-w-full text-right text-balance", DIM_TEXT.down)}>
            {view.downHeading}&nbsp;▾
          </span>
          {twoWay && (
            <span className={cn("w-min min-w-full text-right text-balance", DIM_TEXT.up)}>
              {view.upHeading}&nbsp;▴
            </span>
          )}
        </div>
      )}
      <div className="relative col-span-full grid grid-cols-subgrid">
        <svg
          data-strip
          width={nameX}
          height={drawH}
          aria-hidden="true"
          focusable="false"
          className="pointer-events-none absolute top-0 left-0 overflow-visible"
        >
          {pieces.map((p, i) => {
            const on = version == null || p.versions.includes(version);
            return (
              <path
                key={i}
                d={p.d}
                fill="none"
                strokeWidth={LINE_W}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={on ? (lineHex ? undefined : "stroke-at-shore") : "stroke-at-border"}
                style={on && lineHex ? { stroke: lineHex } : undefined}
              />
            );
          })}
          {col.rows.map(({ index, x, y }) => {
            const row = view.rows[index]!;
            const r = row.terminus ? TERMINUS_R : RING_R;
            return (
              <g key={index}>
                {alerts.has(strip.rows[index]!.key) && (
                  <circle
                    cx={x}
                    cy={y}
                    r={r + 5}
                    fill="none"
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                    className="stroke-at-muted/60"
                  />
                )}
                <Ring x={x} y={y} r={r} row={row} twoWay={twoWay} />
              </g>
            );
          })}
        </svg>
        <ol
          start={(col.rows[0]?.index ?? 0) + 1}
          className="col-span-full grid auto-rows-8 grid-cols-subgrid"
          style={{ paddingBottom: drawH - rowsH }}
        >
          {col.rows.map(({ index }) => {
            const row = view.rows[index]!;
            const shown = row.state === "on";
            return (
              <li
                key={index}
                ref={(el) => setRef(index, el)}
                tabIndex={index === active ? 0 : -1}
                onFocus={() => onFocusRow(index)}
                onKeyDown={(e) => onKey(e, index)}
                className="col-span-full grid grid-cols-subgrid items-center"
              >
                <span className="sr-only">{row.sentence}</span>
                <span
                  aria-hidden="true"
                  style={{ paddingLeft: nameX }}
                  className={cn(
                    // Two 16px lines fill a 32px row, so a phone wraps a long name
                    // rather than cutting it to a few letters. Wider, one line: a clamp,
                    // not truncate, since Chrome still breaks at a wbr under nowrap.
                    "line-clamp-2 text-xs sm:line-clamp-1 sm:text-sm",
                    row.state !== "on"
                      ? "text-at-muted/50"
                      : row.bothWays
                        ? "font-medium text-at-ink"
                        : "text-at-muted",
                    row.terminus && "font-bold",
                  )}
                >
                  {breakable(row.name)}
                </span>
                {figures && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "text-right text-xs whitespace-nowrap tabular-nums sm:min-w-22 sm:text-sm",
                      FIGURE_TEXT[row.down.tone],
                      DIM_TEXT.down,
                    )}
                  >
                    {shown ? row.down.text : ""}
                  </span>
                )}
                {figures && twoWay && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "text-right text-xs whitespace-nowrap tabular-nums sm:min-w-22 sm:text-sm",
                      FIGURE_TEXT[row.up.tone],
                      DIM_TEXT.up,
                    )}
                  >
                    {shown ? row.up.text : ""}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/**
 * A stop's ring: split between the two directions, each half in its band's colour and dashed
 * where that direction doesn't stop; a filled grey ring off the picked version, and an open one
 * where the version passes without stopping.
 * @param props - Props.
 * @param props.x - Centre x.
 * @param props.y - Centre y.
 * @param props.r - Radius.
 * @param props.row - What the row shows.
 * @param props.twoWay - Whether the route runs both ways; a one-way route's rings are whole.
 * @returns The ring.
 */
function Ring({
  x,
  y,
  r,
  row,
  twoWay,
}: {
  x: number;
  y: number;
  r: number;
  row: StripView["rows"][number];
  twoWay: boolean;
}): JSX.Element {
  if (row.state !== "on") {
    return (
      <circle
        cx={x}
        cy={y}
        r={r}
        strokeWidth={RING_W}
        className={cn("stroke-at-border", row.state === "pass" ? "fill-none" : "fill-at-surface")}
      />
    );
  }
  if (!twoWay) {
    const tone = row.down.tone === "unserved" ? row.up.tone : row.down.tone;
    return (
      <circle
        cx={x}
        cy={y}
        r={r}
        strokeWidth={RING_W}
        className={cn("fill-at-surface", HALF_STROKE[tone])}
      />
    );
  }
  return (
    <>
      <circle cx={x} cy={y} r={r} className="fill-at-surface" />
      {/* Left half, bottom round to top: the first column's direction. */}
      <path
        d={`M ${x} ${y + r} A ${r} ${r} 0 0 1 ${x} ${y - r}`}
        fill="none"
        strokeWidth={RING_W}
        strokeDasharray={row.down.tone === "unserved" ? "3 3" : undefined}
        className={cn(HALF_STROKE[row.down.tone], DIM_HALF.down)}
      />
      <path
        d={`M ${x} ${y - r} A ${r} ${r} 0 0 1 ${x} ${y + r}`}
        fill="none"
        strokeWidth={RING_W}
        strokeDasharray={row.up.tone === "unserved" ? "3 3" : undefined}
        className={cn(HALF_STROKE[row.up.tone], DIM_HALF.up)}
      />
    </>
  );
}

/**
 * The key under the strip, naming only what is on screen. The delay colours are in the map's key
 * above, so this covers the marks they don't.
 * @param props - Props.
 * @param props.view - What the strip shows.
 * @param props.twoWay - Whether the rings are split.
 * @param props.perStop - Whether figures are shown per stop.
 * @param props.alert - Whether a stop is named in an alert.
 * @param props.colour - The route's colour, for the line swatch.
 * @returns The key, or null when there is nothing to explain.
 */
function StripKey({
  view,
  twoWay,
  perStop,
  alert,
  colour,
}: {
  view: StripView;
  twoWay: boolean;
  perStop: boolean;
  alert: boolean;
  colour: string | null;
}): JSX.Element | null {
  const lineHex = brandColour(colour);
  const entries: Array<{ key: string; swatch: JSX.Element; label: string }> = [];
  /**
   * A half-ring swatch: the given halves on a white ring.
   * @param left - The left half's stroke class and dash.
   * @param left.cls - Its stroke class.
   * @param left.dash - Its dash pattern, if any.
   * @param right - The right half's.
   * @param right.cls - Its stroke class.
   * @param right.dash - Its dash pattern, if any.
   * @returns The swatch.
   */
  const halves = (
    left: { cls: string; dash?: string },
    right: { cls: string; dash?: string },
  ): JSX.Element => (
    <>
      <circle cx={10} cy={10} r={6} className="fill-at-surface" />
      <path
        d="M 10 16 A 6 6 0 0 1 10 4"
        fill="none"
        strokeWidth={3.5}
        strokeDasharray={left.dash}
        className={left.cls}
      />
      <path
        d="M 10 4 A 6 6 0 0 1 10 16"
        fill="none"
        strokeWidth={3.5}
        strokeDasharray={right.dash}
        className={right.cls}
      />
    </>
  );
  if (twoWay) {
    entries.push({
      key: "split",
      swatch: halves({ cls: "stroke-at-late" }, { cls: "stroke-at-ontime" }),
      label: `Left half: ${midSentence(view.downHeading)}. Right half: ${midSentence(view.upHeading)}`,
    });
  }
  if (twoWay && view.present.unserved) {
    entries.push({
      key: "unserved",
      swatch: halves({ cls: "stroke-at-ontime" }, { cls: "stroke-at-muted/60", dash: "3 3" }),
      label: "Dashed half: doesn't stop that way",
    });
  }
  if (perStop && view.present.none) {
    entries.push({
      key: "none",
      swatch: halves({ cls: "stroke-at-ontime" }, { cls: "stroke-at-border" }),
      label: "Grey: no arrivals recorded",
    });
  }
  if (view.present.off) {
    entries.push({
      key: "off",
      swatch: (
        <>
          <line
            x1={2}
            x2={18}
            y1={10}
            y2={10}
            strokeWidth={5}
            strokeLinecap="round"
            className="stroke-at-border"
          />
          <circle
            cx={10}
            cy={10}
            r={5}
            strokeWidth={3}
            className="fill-at-surface stroke-at-border"
          />
        </>
      ),
      label: "Not part of the version picked",
    });
  }
  if (view.present.pass) {
    entries.push({
      key: "pass",
      swatch: (
        <>
          <line
            x1={10}
            x2={10}
            y1={1}
            y2={19}
            strokeWidth={5}
            className={lineHex ? undefined : "stroke-at-shore"}
            style={lineHex ? { stroke: lineHex } : undefined}
          />
          <circle cx={10} cy={10} r={5} strokeWidth={3} className="fill-none stroke-at-border" />
        </>
      ),
      label: "Passed without stopping",
    });
  }
  if (alert) {
    entries.push({
      key: "alert",
      swatch: (
        <>
          <circle
            cx={10}
            cy={10}
            r={4.5}
            strokeWidth={2.5}
            className="fill-at-surface stroke-at-ontime"
          />
          <circle
            cx={10}
            cy={10}
            r={8.5}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray="3 2"
            className="stroke-at-muted/60"
          />
        </>
      ),
      label: "Named in a service alert",
    });
  }
  if (entries.length === 0) return null;
  return (
    <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-at-muted">
      {entries.map((e) => (
        <div key={e.key} className="flex items-center gap-1.5">
          <dt>
            <svg width={20} height={20} aria-hidden="true" focusable="false">
              {e.swatch}
            </svg>
          </dt>
          <dd>{e.label}</dd>
        </div>
      ))}
    </dl>
  );
}
