// src/components/TripLine.tsx
// The trip page's stop timeline drawn as a transit map: the run's stops on one
// vertical line in the route's colour, with the stops it made off its timetable
// on a spur beside it and the stops it went around bypassed.

import { brandColour } from "@/components/ModeIcon";
import { cn } from "@/lib/cn";
import { formatDelay, formatGtfsTime } from "@/lib/format";
import { fitLabel, labelWidth } from "@/lib/label-width";
import { delayBand } from "@/lib/on-time";
import { nzClockTime } from "@/lib/time";
import type { LineLeg, LineStop, TripLine as TripLineData } from "@/lib/trip-line";
import type { JSX } from "react";

/** Height of one stop's row (px). */
const ROW_H = 52;
/** The circle's centre, down from the top of its row: level with the name. */
const DOT_Y = 17;
/** The line's x, and the spur's x beside it. */
const LINE_X = 14;
const SPUR_X = 38;
/** Where the text starts, clear of the line alone or of the spur too. */
const TEXT_X = 34;
const TEXT_X_SPUR = 58;
const NAME_PX = 14;
const SUB_PX = 13;
/** Gap kept between a name and the figure at the right of its row. */
const FIGURE_GAP = 10;

/**
 * The narrowest the drawing is at each layout: the phone copy's width at a 360px
 * screen, and the wide copy's at the 640px `sm` breakpoint. A name is fitted to
 * the narrowest, so it never runs under the figure beside it.
 */
const PHONE_W = 294;
const WIDE_W = 574;

/** Tailwind fill class for a recorded stop's delay figure. */
const BAND_TEXT = { late: "fill-at-late", early: "fill-at-early-strong", ontime: "fill-at-ink" };
/** Tailwind stroke class for a recorded stop's ring. */
const BAND_RING = { late: "stroke-at-late", early: "stroke-at-early", ontime: "stroke-at-ontime" };

/**
 * When the vehicle reached a recorded stop, as an NZ clock time.
 * @param s - The recorded stop.
 * @returns The clock time of schedule plus deviation.
 */
function actualClock(s: NonNullable<LineStop["recorded"]>): string {
  return nzClockTime(new Date(Date.parse(s.scheduled_at) + s.deviation_sec * 1000).toISOString());
}

/**
 * A stop's scheduled time: the recorded arrival's, else the timetable's.
 * @param s - The stop.
 * @returns The clock time, or null when neither is known.
 */
function schedClock(s: LineStop): string | null {
  if (s.recorded) return nzClockTime(s.recorded.scheduled_at);
  return formatGtfsTime(s.departure_time);
}

/** What the right of a row says: a delay, a tag, or nothing. */
interface RowFigure {
  text: string;
  className: string;
}

/**
 * The figure at the right of a stop's row.
 * @param s - The stop.
 * @param mode - The route's mode, for its on-time window.
 * @returns The figure, or null for a stop with nothing to say there.
 */
function rowFigure(s: LineStop, mode: string): RowFigure | null {
  if (s.recorded) {
    const band = delayBand(s.recorded.deviation_sec, mode);
    return { text: formatDelay(s.recorded.deviation_sec, { mode }), className: BAND_TEXT[band] };
  }
  if (s.state === "not-served") return { text: "Not served", className: "fill-at-late" };
  if (s.state === "skipped") return { text: "Skipped", className: "fill-at-muted" };
  return null;
}

/**
 * The sentence a screen reader hears for a stop, in place of the drawing.
 * @param s - The stop.
 * @param mode - The route's mode.
 * @returns The sentence.
 */
function stopSentence(s: LineStop, mode: string): string {
  const sched = schedClock(s);
  if (s.recorded) {
    const where = s.offTimetable ? "not on the timetable" : `scheduled ${sched}`;
    const delay = formatDelay(s.recorded.deviation_sec, { mode });
    return `${s.name}: ${where}, arrived ${actualClock(s.recorded)}, ${delay}.`;
  }
  const at = sched ? `scheduled ${sched}` : "scheduled";
  if (s.state === "not-served") return `${s.name}: ${at}, not served.`;
  if (s.state === "skipped") return `${s.name}: ${at}, skipped by the detour.`;
  return `${s.name}: ${at}, no arrival recorded.`;
}

/** Props for {@link TripLine}. */
export interface TripLineProps {
  /** The line from `buildTripLine`. */
  line: TripLineData;
  /** The route's mode, for the on-time window. */
  mode: string;
  /** The route's GTFS colour (hex, no hash), or null for the site's blue. */
  colour: string | null;
}

/**
 * The trip timeline as a transit map, laid out twice (phone and wide) and
 * switched by CSS, so the server HTML is right for the width without a
 * re-layout on hydration. The drawing is hidden from assistive tech, which gets
 * an ordered list of the same stops in words.
 * @param props - See {@link TripLineProps}.
 * @param props.line - The line.
 * @param props.mode - The route's mode.
 * @param props.colour - The route's colour.
 * @returns The timeline and its key.
 */
export function TripLine({ line, mode, colour }: TripLineProps): JSX.Element {
  const present = {
    unrecorded: line.stops.some((s) => s.state === "unrecorded"),
    skipped: line.stops.some((s) => s.state === "skipped"),
    notServed: line.stops.some((s) => s.state === "not-served"),
    offTimetable: line.stops.some((s) => s.offTimetable),
    ahead: line.legs.some((g) => g.kind === "ahead"),
  };
  return (
    <>
      <div className="sm:hidden">
        <LineSvg line={line} mode={mode} colour={colour} width={PHONE_W} compact />
      </div>
      <div className="hidden sm:block">
        <LineSvg line={line} mode={mode} colour={colour} width={WIDE_W} compact={false} />
      </div>
      <ol className="sr-only">
        {line.stops.map((s, i) => (
          <li key={`${s.stop_id}-${i}`}>{stopSentence(s, mode)}</li>
        ))}
      </ol>
      <LineKey present={present} />
    </>
  );
}

/**
 * Whether a leg along the line passes over a stop the run went around, so it
 * has to be drawn bowing out rather than straight through that stop.
 * @param stops - The line's stops.
 * @param leg - The leg.
 * @returns True when a skipped stop lies between its ends.
 */
function jumpsSkipped(stops: readonly LineStop[], leg: LineLeg): boolean {
  for (let i = leg.from + 1; i < leg.to; i++) if (stops[i]!.state === "skipped") return true;
  return false;
}

/**
 * One layout of the drawing. The svg has no viewBox, so it draws at 1:1 at any
 * width and the figures anchor to its right edge through `x="100%"`; only the
 * names depend on `width`, which they are fitted to.
 * @param props - Props.
 * @param props.line - The line.
 * @param props.mode - The route's mode.
 * @param props.colour - The route's colour.
 * @param props.width - The narrowest this layout is drawn (px).
 * @param props.compact - Shorter wording for the phone.
 * @returns The svg.
 */
function LineSvg({
  line,
  mode,
  colour,
  width,
  compact,
}: {
  line: TripLineData;
  mode: string;
  colour: string | null;
  width: number;
  compact: boolean;
}): JSX.Element {
  const { stops, legs, bypasses } = line;
  const bowed = legs.map((g) => jumpsSkipped(stops, g));
  const hasSpur = stops.some((s) => s.offTimetable) || bowed.some(Boolean);
  const textX = hasSpur ? TEXT_X_SPUR : TEXT_X;
  const lineHex = brandColour(colour);
  /**
   * A stop's circle centre, down the drawing.
   * @param i - Line index.
   * @returns The y (px).
   */
  const cy = (i: number): number => i * ROW_H + DOT_Y;
  /**
   * A stop's circle centre across: on the line, or on the spur when off the timetable.
   * @param i - Line index.
   * @returns The x (px).
   */
  const cx = (i: number): number => (stops[i]!.offTimetable ? SPUR_X : LINE_X);

  return (
    <svg
      width="100%"
      height={stops.length * ROW_H}
      aria-hidden="true"
      focusable="false"
      className="block overflow-visible"
    >
      {/* Bypasses sit under the path: the timetabled stretch the run left. */}
      {bypasses.map((b) => (
        <line
          key={`by-${b.from}`}
          x1={LINE_X}
          x2={LINE_X}
          y1={cy(b.from)}
          y2={cy(b.to)}
          strokeWidth={3}
          strokeDasharray="3 5"
          strokeLinecap="round"
          className="stroke-at-muted"
        />
      ))}

      {legs.map((g, k) => {
        const x1 = cx(g.from);
        const x2 = cx(g.to);
        const y1 = cy(g.from);
        const y2 = cy(g.to);
        // Straight down the line; an S-curve onto or off the spur; or a bow out
        // past the stops the run went around, reaching about the spur's x.
        const d = bowed[k]
          ? `M ${x1} ${y1} C ${SPUR_X + 8} ${y1}, ${SPUR_X + 8} ${y2}, ${x2} ${y2}`
          : x1 === x2
            ? `M ${x1} ${y1} L ${x2} ${y2}`
            : `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
        const offPath = bowed[k] || x1 !== x2 || stops[g.from]!.offTimetable;
        if (g.kind === "ahead" || g.kind === "not-served") {
          return (
            <path
              key={`leg-${k}`}
              d={d}
              fill="none"
              strokeWidth={g.kind === "ahead" ? 6 : 4}
              strokeDasharray={g.kind === "not-served" ? "4 5" : undefined}
              strokeLinecap="round"
              className="stroke-at-border"
            />
          );
        }
        if (offPath) {
          return (
            <path
              key={`leg-${k}`}
              d={d}
              fill="none"
              strokeWidth={4}
              strokeDasharray="6 4"
              strokeLinecap="round"
              className="stroke-at-commercial"
            />
          );
        }
        return (
          <path
            key={`leg-${k}`}
            d={d}
            fill="none"
            strokeWidth={6}
            strokeLinecap="round"
            className={lineHex ? undefined : "stroke-at-shore"}
            style={lineHex ? { stroke: lineHex } : undefined}
          />
        );
      })}

      {stops.map((s, i) => {
        const y0 = i * ROW_H;
        const terminus = i === 0 || i === stops.length - 1;
        const ring = s.recorded
          ? BAND_RING[delayBand(s.recorded.deviation_sec, mode)]
          : s.state === "not-served"
            ? "stroke-at-late"
            : s.state === "skipped"
              ? "stroke-at-muted"
              : "stroke-at-border";
        const figure = rowFigure(s, mode);
        const figureW = figure ? labelWidth(figure.text, NAME_PX) + FIGURE_GAP : 0;
        const name = fitLabel(s.name, NAME_PX, width - textX - figureW);
        const sched = schedClock(s);
        const muted = !s.recorded;
        return (
          <g key={`${s.stop_id}-${i}`}>
            <circle
              cx={cx(i)}
              cy={cy(i)}
              r={terminus ? 8 : 6}
              strokeWidth={3}
              strokeDasharray={s.state === "skipped" ? "2 2.7" : undefined}
              className={cn("fill-at-surface", ring)}
            />
            <text
              x={textX}
              y={y0 + DOT_Y + 5}
              fontSize={NAME_PX}
              className={cn(
                "font-medium",
                muted ? "fill-at-muted" : "fill-at-ink",
                s.state === "not-served" && "line-through",
              )}
            >
              {name}
            </text>
            <text
              x={textX}
              y={y0 + DOT_Y + 23}
              fontSize={SUB_PX}
              className="fill-at-muted tabular-nums"
            >
              {s.recorded && s.offTimetable ? (
                <>
                  {compact ? "Off timetable" : "Not on the timetable"} · Actual{" "}
                  <tspan className={BAND_TEXT[delayBand(s.recorded.deviation_sec, mode)]}>
                    {actualClock(s.recorded)}
                  </tspan>
                </>
              ) : s.recorded ? (
                <>
                  Sched <tspan className="fill-at-ink">{sched}</tspan> · Actual{" "}
                  <tspan className={BAND_TEXT[delayBand(s.recorded.deviation_sec, mode)]}>
                    {actualClock(s.recorded)}
                  </tspan>
                </>
              ) : (
                <>
                  Sched <tspan className="fill-at-ink">{sched ?? "-"}</tspan>
                </>
              )}
            </text>
            {figure && (
              <text
                x="100%"
                y={y0 + DOT_Y + 5}
                fontSize={NAME_PX}
                textAnchor="end"
                className={cn("font-semibold tabular-nums", figure.className)}
              >
                {figure.text}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The key under the line, naming only the states on screen: the three delay
 * colours are in the map's key above, so this covers what they do not.
 * @param props - Props.
 * @param props.present - Which states the line draws.
 * @param props.present.unrecorded - A timetabled stop with no arrival recorded.
 * @param props.present.skipped - A stop the run went around.
 * @param props.present.notServed - A stop the run never reached.
 * @param props.present.offTimetable - A stop the run made off its timetable.
 * @param props.present.ahead - A leg a live run has not reached yet.
 * @returns The key, or null when there is nothing to explain.
 */
function LineKey({
  present,
}: {
  present: {
    unrecorded: boolean;
    skipped: boolean;
    notServed: boolean;
    offTimetable: boolean;
    ahead: boolean;
  };
}): JSX.Element | null {
  const entries: Array<{ key: string; swatch: JSX.Element; label: string }> = [];
  /**
   * A stop-circle swatch.
   * @param ring - The ring's stroke class.
   * @param dash - Its dash pattern, if any.
   * @returns The circle.
   */
  const dot = (ring: string, dash?: string): JSX.Element => (
    <circle
      cx={9}
      cy={7}
      r={5}
      strokeWidth={2.5}
      strokeDasharray={dash}
      className={cn("fill-at-surface", ring)}
    />
  );
  /**
   * A leg swatch.
   * @param cls - The stroke class.
   * @param width - Stroke width (px).
   * @param dash - Its dash pattern, if any.
   * @returns The line.
   */
  const leg = (cls: string, width: number, dash?: string): JSX.Element => (
    <line
      x1={2}
      x2={16}
      y1={7}
      y2={7}
      strokeWidth={width}
      strokeDasharray={dash}
      strokeLinecap="round"
      className={cls}
    />
  );
  if (present.unrecorded)
    entries.push({
      key: "unrecorded",
      swatch: dot("stroke-at-border"),
      label: "Scheduled, with no arrival recorded",
    });
  if (present.offTimetable)
    entries.push({
      key: "off",
      swatch: leg("stroke-at-commercial", 3, "4 3"),
      label: "Off the timetable's path",
    });
  if (present.skipped)
    entries.push({
      key: "skipped",
      swatch: dot("stroke-at-muted", "2 2"),
      label: "Skipped: the run went around it",
    });
  if (present.notServed)
    entries.push({
      key: "not-served",
      swatch: dot("stroke-at-late"),
      label: "The run never reached this stop",
    });
  if (present.ahead)
    entries.push({ key: "ahead", swatch: leg("stroke-at-border", 4), label: "Not reached yet" });
  if (entries.length === 0) return null;
  return (
    <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-at-muted">
      {entries.map((e) => (
        <div key={e.key} className="flex items-center gap-1.5">
          <dt>
            <svg width={18} height={14} aria-hidden="true" focusable="false">
              {e.swatch}
            </svg>
          </dt>
          <dd>{e.label}</dd>
        </div>
      ))}
    </dl>
  );
}
