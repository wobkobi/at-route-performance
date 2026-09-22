// src/lib/strip-view.ts
// What each row of the route strip shows for the version picked: the two halves of its ring, the
// figure in each column, how its name reads, and the sentence a screen reader hears in place of
// the drawing. Pure and client-safe, so the version chips can swap it without a server trip.
import { formatDelay } from "@/lib/format";
import { delayBand } from "@/lib/on-time";
import { rowFigure, type RouteStrip, type StripRow } from "@/lib/route-strip";
import type { StopFigures, StopSplit } from "@/lib/stop-split";

/**
 * One half of a stop's ring, and its figure column's tone.
 * - `late`, `early`, `ontime`: the band of the figure recorded there.
 * - `none`: the direction stops there, with no arrival recorded (or no figures to show).
 * - `unserved`: the direction doesn't stop there, drawn dashed with a dash in the column.
 */
export type HalfTone = "late" | "early" | "ontime" | "none" | "unserved";

/** One direction's half of a row. */
export interface SideView {
  tone: HalfTone;
  /** The figure column's text: a delay, or a dash. */
  text: string;
}

/**
 * Where a row stands against the version picked.
 * - `on`: the version stops there, or no version is picked.
 * - `pass`: the version's line runs through it without stopping, drawn as an open ring.
 * - `off`: the version doesn't come near it, drawn as a filled grey ring with a dim name.
 */
export type RowState = "on" | "pass" | "off";

/** What one row shows. */
export interface StripRowView {
  name: string;
  terminus: boolean;
  state: RowState;
  /** Served both ways by what is picked (or at all, on a one-way route): an ink name, else muted. */
  bothWays: boolean;
  down: SideView;
  up: SideView;
  /** The row in words, for a screen reader. */
  sentence: string;
}

/** What the whole strip shows for the version picked. */
export interface StripView {
  rows: StripRowView[];
  /** The figure columns' headings, without their arrows: "To Glen Innes Station". */
  downHeading: string;
  upHeading: string;
  /** Which states are on screen, so the key lists only those. */
  present: { unserved: boolean; none: boolean; off: boolean; pass: boolean };
}

/** What {@link stripView} reads. */
export interface StripViewInput {
  strip: RouteStrip;
  /** The day's figures, or null where there are none per stop (the week view). */
  split: StopSplit | null;
  /** The picked version's key, or null for every version. */
  version: string | null;
  mode: string;
}

/** Where one side's runs end and which way round they go, as {@link headings} reads them. */
interface SideEnds {
  to: string | null;
  way: string | null;
}

/**
 * The two columns' headings: where the runs each way end ("To Glen Innes Station"), or "To the
 * end" and "To the start" when they end in different places. A circuit run both ways ends at the
 * same stop both ways, so its columns are named by the way round instead ("Anticlockwise").
 * @param down - The runs reading down the page.
 * @param up - The runs reading up it.
 * @returns The down and up headings.
 */
function headings(down: SideEnds, up: SideEnds): [string, string] {
  if (down.to != null && down.to === up.to) {
    if (down.way && up.way && down.way !== up.way) return [down.way, up.way];
    return ["One way round", "The other way round"];
  }
  return [down.to ? `To ${down.to}` : "To the end", up.to ? `To ${up.to}` : "To the start"];
}

/**
 * One direction's half of a row.
 * @param row - The row.
 * @param stops - Whether what is picked stops there that way.
 * @param figures - The figures to read, or null for none per stop.
 * @param dirIds - The side's direction ids.
 * @param mode - The route's mode, for its on-time window.
 * @returns The half.
 */
function side(
  row: StripRow,
  stops: boolean,
  figures: StopFigures | null,
  dirIds: readonly number[],
  mode: string,
): SideView {
  if (!stops) return { tone: "unserved", text: "-" };
  const f = figures ? rowFigure(figures, row, dirIds) : null;
  if (!f) return { tone: "none", text: "-" };
  return { tone: delayBand(f.avg_delay_sec, mode), text: formatDelay(f.avg_delay_sec, { mode }) };
}

/**
 * A half in words.
 * @param s - The half.
 * @param perStop - Whether figures are shown per stop at all.
 * @returns The phrase.
 */
function phrase(s: SideView, perStop: boolean): string {
  if (s.tone === "unserved") return "doesn't stop";
  if (s.tone === "none") return perStop ? "no arrivals recorded" : "stops here";
  return s.text;
}

/**
 * What every row of the strip shows for the version picked. With a version picked, every stop
 * stays where it is: the ones it doesn't use are marked off, the ones its line runs through
 * without stopping are marked as passed, and the figures are that version's runs alone.
 * @param input - See {@link StripViewInput}.
 * @returns The rows, the column headings and the states on screen.
 */
export function stripView(input: StripViewInput): StripView {
  const { strip, split, version, mode } = input;
  const picked = version == null ? null : (strip.versions.find((v) => v.key === version) ?? null);
  const figures = split ? (picked ? (split.byVersion[picked.key] ?? {}) : split.all) : null;
  const downRows = picked ? new Set(picked.downRows) : null;
  const upRows = picked ? new Set(picked.upRows) : null;
  const passes = new Set(picked?.passes ?? []);
  const ends = picked ?? strip;
  const [downHeading, upHeading] = headings(
    { to: ends.downTo, way: ends.downWay },
    { to: ends.upTo, way: ends.upWay },
  );
  const twoWay = strip.down.length > 0 && strip.up.length > 0;
  const present = { unserved: false, none: false, off: false, pass: false };

  const rows = strip.rows.map((row, i): StripRowView => {
    const stopsDown = downRows ? downRows.has(i) : row.down;
    const stopsUp = upRows ? upRows.has(i) : row.up;
    const state: RowState =
      stopsDown || stopsUp ? "on" : passes.has(i) ? "pass" : picked ? "off" : "on";
    const down = side(row, stopsDown, figures, strip.down, mode);
    const up = side(row, stopsUp, figures, strip.up, mode);
    const name = row.name;
    let sentence: string;
    if (state === "off") {
      present.off = true;
      sentence = `${name}: not on this version.`;
    } else if (state === "pass") {
      present.pass = true;
      sentence = `${name}: this version passes without stopping.`;
    } else {
      const halves = twoWay ? [down, up] : [strip.down.length > 0 ? down : up];
      if (halves.some((h) => h.tone === "unserved")) present.unserved = true;
      if (split && halves.some((h) => h.tone === "none")) present.none = true;
      const parts = twoWay
        ? [`${downHeading}, ${phrase(down, !!split)}`, `${upHeading}, ${phrase(up, !!split)}`]
        : [phrase(halves[0]!, !!split)];
      sentence = `${name}${row.terminus ? ", terminus" : ""}: ${parts.join("; ")}.`;
    }
    return {
      name,
      terminus: row.terminus,
      state,
      bothWays: twoWay ? stopsDown && stopsUp : stopsDown || stopsUp,
      down,
      up,
      sentence,
    };
  });
  return { rows, downHeading, upHeading, present };
}
