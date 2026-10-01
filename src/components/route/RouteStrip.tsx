"use client";
// src/components/route/RouteStrip.tsx
// The route diagram as a strip map: one line down the page carrying both directions, each stop a
// ring split between them, with its name and a figure column per direction beside it. The line
// and rings are one svg behind each column, drawn 1:1 from lib/strip/route-strip.ts; the names and
// figures are the rows of a list on the same 32px pitch, so CSS wraps or cuts a name to fit and
// the figure columns size to their widest figure.

import { ChipToggle } from "@/components/Chip";
import { ChevronDown } from "@/components/icons";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SvgSwatch, SwatchKey } from "@/components/ui/SwatchKey";
import { cn } from "@/lib/cn";
import { stopHref } from "@/lib/page/hrefs";
import { useUrlParam } from "@/lib/page/use-url-param";
import { routeColour } from "@/lib/route/colour";
import type { StripMarks } from "@/lib/strip/marks";
import {
  BYPASS_OFF,
  bypassSpan,
  layoutStrip,
  pickBreaks,
  STRIP_LANE,
  STRIP_ROW,
  type SegmentMark,
  type StripColumn,
  type RouteStrip as StripData,
  type StripSide,
} from "@/lib/strip/route-strip";
import type { StopSplit } from "@/lib/strip/stop-split";
import { midSentence, stripView, type HalfTone, type StripView } from "@/lib/strip/view";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  closed: "stroke-at-muted/60",
};
/** Text class for each figure tone: only the stops off time stand out. */
const FIGURE_TEXT: Record<HalfTone, string> = {
  late: "font-semibold text-at-late",
  early: "font-semibold text-at-early-strong",
  ontime: "text-at-muted",
  none: "text-at-muted",
  unserved: "text-at-muted",
  closed: "text-at-muted",
};
/** Width and dash of a strand, stub or overlay; the plain line is {@link LINE_W} and solid. */
const MARK_STROKE: Record<SegmentMark, { w: number; dash?: string }> = {
  closed: { w: 4 },
  detour: { w: 4 },
  suspect: { w: 4, dash: "6 4" },
  stub: { w: 3, dash: "3 5" },
  announced: { w: 3, dash: "4 4" },
};
/** The detour orange's hue, in degrees. */
const DETOUR_HUE = 32;

/**
 * The detour marks' stroke class: the detour orange, or ink on a route whose own colour is near
 * that orange (the Outer Link), where an orange strand beside an orange line reads as the line.
 * Near means a hue within 25 degrees of it on a colour that isn't washed out, so a red line keeps
 * the orange.
 * @param hex - The route's line colour as `#rrggbb`.
 * @returns The class.
 */
function detourClass(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d < 0.25) return "stroke-at-commercial";
  const hue =
    max === r
      ? (((g - b) / d + 6) % 6) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60;
  return Math.abs(hue - DETOUR_HUE) < 25 ? "stroke-at-ink" : "stroke-at-commercial";
}
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

/** Props for {@link RouteStrip}. */
export interface RouteStripProps {
  /** The route laid out as one strip, from `buildStrip`. */
  strip: StripData;
  /** The day's figures per stop, direction and version, or null where there are none (the week). */
  split: StopSplit | null;
  /** The route's mode, for its on-time window. */
  mode: string;
  /** The route's GTFS colour (hex, no hash), or null for its mode's colour. */
  colour: string | null;
  /** The side the page's direction chip picked, or null for both. */
  side: StripSide | null;
  /** Keys of the rows a live service alert names. */
  alertRows: string[];
  /** The day's closures and detours placed on the strip, or null where none are read (the week). */
  marks: StripMarks | null;
  /** The day a stop's link opens on, or undefined for today or the week. */
  stopDay?: string;
}

/**
 * The route diagram: version chips, the strip laid out once as a single column and once as two
 * (switched by CSS, so the server HTML is right for the width and nothing re-lays out on
 * hydration), the key, and the minor versions listed underneath. The page's direction chip dims
 * the other direction through `data-dir`, so nothing is redrawn and no stop moves; a version chip
 * swaps in that version's figures and greys out what it doesn't use. The picked version is kept
 * in the URL as `ver`, so Back from a page opened off the route returns to it. The day's closures and detours
 * bend strands round the stops they touch, and are named in notes under the key.
 * @param props - See {@link RouteStripProps}.
 * @param props.strip - The strip.
 * @param props.split - The day's figures, or null.
 * @param props.mode - The route's mode.
 * @param props.colour - The route's colour.
 * @param props.side - The direction picked.
 * @param props.alertRows - Rows named in a live alert.
 * @param props.marks - The day's closures and detours, or null.
 * @param props.stopDay - The day a stop's link opens on.
 * @returns The diagram section.
 */
export function RouteStrip({
  strip,
  split,
  mode,
  colour,
  side,
  alertRows,
  marks,
  stopDay,
}: RouteStripProps): JSX.Element {
  const router = useRouter();
  const lineHex = routeColour(mode, colour);
  const searchParams = useSearchParams();
  // Seeded from the live URL, since Back restores a page rendered before `ver` was written.
  // Only a key with a chip on screen counts: a minor version has none, and neither does a route
  // with a single version.
  const [version, setVersion] = useState<string | null>(() => {
    const ver = searchParams.get("ver");
    const majors = strip.versions.filter((v) => !v.minor);
    return majors.length > 1 && majors.some((v) => v.key === ver) ? ver : null;
  });
  useUrlParam("ver", version);
  // The one row in the tab order (roving tabindex), so a 60-stop route is one tab stop.
  const [active, setActive] = useState(0);
  const refs = useRef<Record<"one" | "two", Array<HTMLLIElement | null>>>({ one: [], two: [] });

  const view = useMemo(
    () => stripView({ strip, split, version, mode, marks }),
    [strip, split, version, mode, marks],
  );
  const layouts = useMemo(() => {
    // A column break never falls inside a strand, so a strand is always drawn whole.
    const noBreak = (marks?.bypasses ?? []).map((b): [number, number] => {
      const s = bypassSpan(b);
      return [Math.floor(s.top), Math.ceil(s.bottom)];
    });
    const breaks = strip.rows.length >= WIDE_MIN_ROWS ? pickBreaks(strip, 2, noBreak) : [];
    return {
      one: layoutStrip(strip, [], DIMS, marks),
      two: breaks.length > 0 ? layoutStrip(strip, breaks, DIMS, marks) : null,
    };
  }, [strip, marks]);
  const alerts = useMemo(
    () => new Set([...alertRows, ...(marks?.alertRows ?? []).map((i) => strip.rows[i]!.key)]),
    [alertRows, marks, strip],
  );

  if (strip.rows.length === 0) {
    return (
      <Panel pad="sm">
        <SectionHeading>Line diagram</SectionHeading>
        <EmptyState inset className="mt-2">
          No stopping pattern yet. The diagram fills in once this route records a full run.
        </EmptyState>
      </Panel>
    );
  }

  const chips = strip.versions.filter((v) => !v.minor);
  const minor = strip.versions.filter((v) => v.minor);
  const twoWay = strip.down.length > 0 && strip.up.length > 0;
  // A strand for the second column runs out right of its lane, so the names start clear of it too.
  const reach = Math.max(
    0,
    ...strip.rows.map((r) => r.reach * STRIP_LANE),
    ...(marks?.bypasses ?? [])
      .filter((b) => b.side === "up")
      .map((b) => b.lane * STRIP_LANE + BYPASS_OFF),
  );
  const nameX = DIMS.left + reach + NAME_GAP;
  const hasAlert = strip.rows.some((r) => alerts.has(r.key));

  /**
   * A row's stop page. A row can merge the stops either side of the road; it opens the first.
   * @param i - The row.
   * @returns The link, or null for a row with no stop id.
   */
  const hrefOf = (i: number): string | null => {
    const id = strip.rows[i]?.stopIds[0];
    return id ? stopHref(id, { day: stopDay }) : null;
  };

  /**
   * Step along the rows from the keyboard: the arrows move one stop, Home and End to either end,
   * and Enter opens the focused stop (its name is a link kept out of the tab order).
   * @param e - The key event.
   * @param layout - Which copy of the strip has focus.
   * @param i - The focused row.
   */
  const onKey = (e: KeyboardEvent<HTMLLIElement>, layout: "one" | "two", i: number): void => {
    if (e.key === "Enter") {
      const href = hrefOf(i);
      if (href) router.push(href);
      return;
    }
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
        lineHex={lineHex}
        alerts={alerts}
        active={active}
        setRef={(i, el) => {
          refs.current[layout][i] = el;
        }}
        onFocusRow={setActive}
        onKey={(e, i) => onKey(e, layout, i)}
        hrefOf={hrefOf}
      />
    ));

  return (
    <Panel pad="sm">
      <SectionHeading className="mb-3">Line diagram</SectionHeading>
      {chips.length > 1 && (
        <div role="group" aria-label="Version" className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-at-muted">Version</span>
          <ChipToggle on={version == null} onClick={() => setVersion(null)}>
            {chips.length === 2 ? "Both" : "All"}
          </ChipToggle>
          {chips.map((v) => (
            <ChipToggle key={v.key} on={version === v.key} onClick={() => setVersion(v.key)}>
              {v.from} to {v.to}
            </ChipToggle>
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
          lineHex={lineHex}
        />
      </div>
      {view.notes.length > 0 && (
        <div className="mt-3 border-t border-at-border pt-2 text-xs text-at-muted">
          <p className="font-semibold text-at-ink">
            Closures and detours{view.present.starred ? " (* on a figure)" : ""}
          </p>
          <ul className="mt-1 space-y-1">
            {view.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {minor.length > 0 && (
        <p className="mt-3 border-t border-at-border pt-2 text-xs text-at-muted">
          <span className="font-semibold text-at-ink">Also runs, on a few trips:</span>{" "}
          {minor.map((v) => `${v.from} to ${v.to}`).join(" · ")}
        </p>
      )}
    </Panel>
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
 * @param props.lineHex - The route's line colour.
 * @param props.alerts - Keys of the rows an alert names.
 * @param props.active - The row in the tab order.
 * @param props.setRef - Keeps each row's element, for moving focus.
 * @param props.onFocusRow - Makes a focused row the one in the tab order.
 * @param props.onKey - Steps along the rows.
 * @param props.hrefOf - A row's stop page, or null.
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
  lineHex,
  alerts,
  active,
  setRef,
  onFocusRow,
  onKey,
  hrefOf,
}: {
  col: StripColumn;
  view: StripView;
  strip: StripData;
  version: string | null;
  twoWay: boolean;
  figures: boolean;
  nameX: number;
  lineHex: string;
  alerts: ReadonlySet<string>;
  active: number;
  setRef: (i: number, el: HTMLLIElement | null) => void;
  onFocusRow: (i: number) => void;
  onKey: (e: KeyboardEvent<HTMLLIElement>, i: number) => void;
  hrefOf: (i: number) => string | null;
}): JSX.Element {
  const detour = detourClass(lineHex);
  const rowsH = col.rows.length * STRIP_ROW;
  const drawH = Math.max(rowsH, col.bottom + TERMINUS_R + RING_W);
  // Pieces off the picked version go first, so the line it runs along is drawn over their ends;
  // an announced stretch goes last, since it is drawn over the line it names.
  const pieces = [...col.pieces].sort(
    (a, b) =>
      Number(a.mark === "announced") - Number(b.mark === "announced") ||
      Number(version == null || a.versions.includes(version)) -
        Number(version == null || b.versions.includes(version)),
  );
  return (
    <div
      className={cn(
        // content-start: a column shorter than its neighbour keeps its rows at the top, level
        // with the neighbour's, rather than spreading the extra height between them.
        // A figure column is min-content: as wide as its widest figure (they never wrap) or the
        // longest word of its heading, which wraps inside it. WebKit sizes an auto track from a
        // w-min heading's one-line width, which left a phone's names no room at all.
        "grid content-start gap-x-2 sm:gap-x-3",
        !figures
          ? "grid-cols-1"
          : twoWay
            ? "grid-cols-[minmax(0,1fr)_min-content_min-content]"
            : "grid-cols-[minmax(0,1fr)_min-content]",
      )}
    >
      {figures && (
        <div
          aria-hidden="true"
          className="col-span-full grid grid-cols-subgrid items-end border-b border-at-border pb-1.5 text-xs font-semibold text-at-muted"
        >
          <span />
          <span className={cn("text-right text-balance", DIM_TEXT.down)}>
            {view.downHeading}&nbsp;
            <ChevronDown className="inline h-3.5 w-3.5 align-text-bottom" />
          </span>
          {twoWay && (
            <span className={cn("text-right text-balance", DIM_TEXT.up)}>
              {view.upHeading}&nbsp;
              <ChevronDown className="inline h-3.5 w-3.5 rotate-180 align-text-bottom" />
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
            const stroke = p.mark ? MARK_STROKE[p.mark] : { w: LINE_W };
            // The line and a closed stop's strand take the route's colour; the rest their own.
            const own =
              p.mark === "stub" ? "stroke-at-muted" : p.mark && p.mark !== "closed" ? detour : null;
            return (
              <path
                key={i}
                d={p.d}
                fill="none"
                strokeWidth={stroke.w}
                strokeDasharray={stroke.dash}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={!on ? "stroke-at-border" : (own ?? undefined)}
                style={on && !own ? { stroke: lineHex } : undefined}
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
            const href = hrefOf(index);
            const nameClass = cn(
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
              row.struck && "line-through",
            );
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
                {href ? (
                  // Out of the tab order and hidden from screen readers: the row is the focus
                  // stop and reads the sentence above, and Enter on it follows this link.
                  <Link
                    href={href}
                    tabIndex={-1}
                    aria-hidden="true"
                    style={{ marginLeft: nameX }}
                    className={cn(nameClass, "hover:text-at-shore hover:underline")}
                  >
                    {breakable(row.name)}
                  </Link>
                ) : (
                  <span aria-hidden="true" style={{ paddingLeft: nameX }} className={nameClass}>
                    {breakable(row.name)}
                  </span>
                )}
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
  /**
   * A half's dash: dashed where runs that way didn't stop, as timetabled or on the day.
   * @param tone - The half's tone.
   * @returns The dash pattern, or none.
   */
  const dash = (tone: HalfTone): string | undefined =>
    tone === "unserved" || tone === "closed" ? "3 3" : undefined;
  if (!twoWay) {
    const tone = row.down.tone === "unserved" ? row.up.tone : row.down.tone;
    return (
      <circle
        cx={x}
        cy={y}
        r={r}
        strokeWidth={RING_W}
        strokeDasharray={tone === "closed" ? "3 3" : undefined}
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
        strokeDasharray={dash(row.down.tone)}
        className={cn(HALF_STROKE[row.down.tone], DIM_HALF.down)}
      />
      <path
        d={`M ${x} ${y - r} A ${r} ${r} 0 0 1 ${x} ${y + r}`}
        fill="none"
        strokeWidth={RING_W}
        strokeDasharray={dash(row.up.tone)}
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
 * @param props.lineHex - The route's line colour, for the line swatch.
 * @returns The key, or null when there is nothing to explain.
 */
function StripKey({
  view,
  twoWay,
  perStop,
  alert,
  lineHex,
}: {
  view: StripView;
  twoWay: boolean;
  perStop: boolean;
  alert: boolean;
  lineHex: string;
}): JSX.Element | null {
  const detour = detourClass(lineHex);
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
          <line x1={10} x2={10} y1={1} y2={19} strokeWidth={5} style={{ stroke: lineHex }} />
          <circle cx={10} cy={10} r={5} strokeWidth={3} className="fill-none stroke-at-border" />
        </>
      ),
      label: "Passed without stopping",
    });
  }
  /**
   * A short horizontal stroke, for the strands and stretches.
   * @param cls - Its stroke class, or none for the route's colour.
   * @param w - Its width.
   * @param dash - Its dash pattern, if any.
   * @returns The line.
   */
  const stroke = (cls: string | null, w: number, dash?: string): JSX.Element => (
    <line
      x1={2}
      x2={18}
      y1={10}
      y2={10}
      strokeWidth={w}
      strokeDasharray={dash}
      strokeLinecap="round"
      className={cls ?? undefined}
      style={cls ? undefined : { stroke: lineHex }}
    />
  );
  if (view.present.closed) {
    entries.push({
      key: "closed",
      swatch: (
        <>
          <path
            d="M 7 1 L 7 19 M 7 3 L 14 10 L 7 17"
            fill="none"
            strokeWidth={2.5}
            strokeLinejoin="round"
            style={{ stroke: lineHex }}
          />
          <circle
            cx={7}
            cy={10}
            r={3.5}
            strokeWidth={2}
            strokeDasharray="2 2"
            className="fill-at-surface stroke-at-muted/60"
          />
        </>
      ),
      label: "Runs that way go round a closed stop",
    });
  }
  if (view.present.stub) {
    entries.push({
      key: "stub",
      swatch: stroke("stroke-at-muted", 3, "3 5"),
      label: "No run used this stretch",
    });
  }
  if (view.present.detour) {
    entries.push({
      key: "detour",
      swatch: stroke(detour, 4),
      label: "Detour the runs took",
    });
  }
  if (view.present.suspect) {
    entries.push({
      key: "suspect",
      swatch: stroke(detour, 4, "6 4"),
      label: "Detour seen on one or two runs",
    });
  }
  if (view.present.announced) {
    entries.push({
      key: "announced",
      swatch: (
        <>
          {stroke(null, 6)}
          {stroke(detour, 3, "4 4")}
        </>
      ),
      label: "Detour announced, not yet seen on the runs",
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
  return (
    <SwatchKey
      className="mt-3"
      items={entries.map((e) => ({
        ...e,
        swatch: (
          <SvgSwatch width={20} height={20}>
            {e.swatch}
          </SvgSwatch>
        ),
      }))}
    />
  );
}
