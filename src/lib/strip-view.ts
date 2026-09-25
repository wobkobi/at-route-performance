// src/lib/strip-view.ts
// What each row of the route strip shows for the version picked: the two halves of its ring, the
// figure in each column, how its name reads, and the sentence a screen reader hears in place of
// the drawing, with the day's closures and detours worked in. Pure and client-safe, so the version
// chips can swap it without a server trip.
import { formatDelay } from "@/lib/format";
import { delayBand } from "@/lib/on-time";
import { rowFigure, type RouteStrip, type StripRow, type StripSide } from "@/lib/route-strip";
import type { StopFigures, StopSplit } from "@/lib/stop-split";
import type { MarkKind, MarkNote, SideMark, StripMarks } from "@/lib/strip-marks";
import { nzClockTime } from "@/lib/time";

/**
 * One half of a stop's ring, and its figure column's tone.
 * - `late`, `early`, `ontime`: the band of the figure recorded there.
 * - `none`: the direction stops there, with no arrival recorded (or no figures to show).
 * - `unserved`: the direction doesn't stop there, drawn dashed with a dash in the column.
 * - `closed`: the direction stops there as timetabled, but runs didn't that day: drawn dashed
 *   like `unserved`, with "closed" or "detour" in the column.
 */
export type HalfTone = "late" | "early" | "ontime" | "none" | "unserved" | "closed";

/** One direction's half of a row. */
export interface SideView {
  tone: HalfTone;
  /** The figure column's text: a delay, "closed", "detour", or a dash. */
  text: string;
  /** The day's closure or detour on this half, if any. */
  mark: MarkKind | null;
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
  /** Closed all day every way it is served (rule 22): its name is struck through. */
  struck: boolean;
  down: SideView;
  up: SideView;
  /** The row in words, for a screen reader. */
  sentence: string;
}

/** Which states are on screen, so the key lists only those. */
export interface StripPresent {
  unserved: boolean;
  none: boolean;
  off: boolean;
  pass: boolean;
  /** A strand round a stop closed that way. */
  closed: boolean;
  /** A strand for a detour enough runs took, and one for a run or two. */
  detour: boolean;
  suspect: boolean;
  /** A stretch of line no run used. */
  stub: boolean;
  /** A stretch an announced detour names. */
  announced: boolean;
  /** A figure with a `*`, explained in the notes. */
  starred: boolean;
}

/** What the whole strip shows for the version picked. */
export interface StripView {
  rows: StripRowView[];
  /** The figure columns' headings, without their arrows: "To Glen Innes Station". */
  downHeading: string;
  upHeading: string;
  present: StripPresent;
  /** The day's closures and detours in words, top of the strip first. */
  notes: string[];
}

/** What {@link stripView} reads. */
export interface StripViewInput {
  strip: RouteStrip;
  /** The day's figures, or null where there are none per stop (the week view). */
  split: StopSplit | null;
  /** The picked version's key, or null for every version. */
  version: string | null;
  mode: string;
  /** The day's closures and detours, or null where none are read (the week view). */
  marks?: StripMarks | null;
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
 * A heading as it reads mid-sentence: "To the start" > "to the start". Only the first letter
 * changes, so a stop's name keeps its capitals.
 * @param heading - The heading.
 * @returns It with a lower-case first letter.
 */
function midSentence(heading: string): string {
  return heading.charAt(0).toLowerCase() + heading.slice(1);
}

/**
 * One direction's half of a row. A closure or detour keeps whatever figure the runs outside it
 * left, with a `*` for the note; with none left, the column names it instead of a dash.
 * @param row - The row.
 * @param stops - Whether what is picked stops there that way.
 * @param figures - The figures to read, or null for none per stop.
 * @param dirIds - The side's direction ids.
 * @param mode - The route's mode, for its on-time window.
 * @param mark - The day's closure or detour on that side, if any.
 * @returns The half.
 */
function side(
  row: StripRow,
  stops: boolean,
  figures: StopFigures | null,
  dirIds: readonly number[],
  mode: string,
  mark: SideMark | null,
): SideView {
  if (!stops) return { tone: "unserved", text: "-", mark: null };
  const f = figures ? rowFigure(figures, row, dirIds) : null;
  const kind = mark?.kind ?? null;
  if (f) {
    // The tone carries the window, the text carries the distance: an average inside the window
    // prints how far off it was in the on-time colour, rather than reading as "on time".
    return {
      tone: delayBand(f.avg_delay_sec, mode),
      text: `${formatDelay(f.avg_delay_sec, { thresholdSec: 0 })}${kind ? "*" : ""}`,
      mark: kind,
    };
  }
  if (kind) return { tone: "closed", text: kind === "closed" ? "closed" : "detour", mark: kind };
  return { tone: "none", text: "-", mark: null };
}

/**
 * A half in words.
 * @param s - The half.
 * @param perStop - Whether figures are shown per stop at all.
 * @returns The phrase.
 */
function phrase(s: SideView, perStop: boolean): string {
  if (s.tone === "unserved") return "doesn't stop";
  if (s.tone === "closed") return s.mark === "closed" ? "closed" : "gone round on a detour";
  if (s.tone === "none") return perStop ? "no arrivals recorded" : "stops here";
  return s.mark ? `${s.text.slice(0, -1)}, with a closure or detour in the notes` : s.text;
}

/**
 * When a closure or detour held, inside the day.
 * @param n - The note.
 * @returns "all day", "from 9:05 am", "until 2:30 pm" or "9:05 am to 2:30 pm".
 */
function when(n: MarkNote): string {
  /**
   * An instant as a clock time.
   * @param ms - Epoch ms.
   * @returns The time.
   */
  const clock = (ms: number): string => nzClockTime(new Date(ms).toISOString());
  if (n.from == null && n.to == null) return "all day";
  if (n.to == null) return `from ${clock(n.from!)}`;
  if (n.from == null) return `until ${clock(n.to)}`;
  return `${clock(n.from)} to ${clock(n.to)}`;
}

/**
 * A closure or detour in words, for the notes under the diagram: where, which way, what, when,
 * and what said so.
 * @param n - The note.
 * @param strip - The strip, for the stops' names.
 * @param down - The first column's heading.
 * @param up - The second's.
 * @returns The sentence.
 */
function noteText(n: MarkNote, strip: RouteStrip, down: string, up: string): string {
  const [lo, hi] = n.rows;
  const first = strip.rows[lo]!.name;
  const last = strip.rows[hi]!.name;
  const seen = n.source === "seen";
  const where = seen
    ? `Between ${first} and ${last}`
    : lo === hi || first === last
      ? first
      : `${first} to ${last}`;
  const way = n.side === "both" ? "" : `, ${midSentence(n.side === "down" ? down : up)}`;
  // A detour's row keeps only its newest runs, so only a suspected one's count is whole.
  const runs = n.runs === 1 ? "1 run" : `${n.runs} runs`;
  const what: Record<MarkNote["kind"], string> = {
    closed: `closed ${when(n)}`,
    detour: `runs went round it, ${when(n)}`,
    suspect: `${runs} went round it, ${when(n)}, too few in two hours to call a detour`,
    announced: `a detour announced ${when(n)}, not yet seen on the runs`,
    disputed: `a detour announced ${when(n)}, but the last runs through stayed on route`,
  };
  const said =
    n.source === "skipped"
      ? " AT's feed marked it skipped."
      : n.alert
        ? ` AT alert: "${n.alert}".`
        : seen
          ? " No alert announced it."
          : "";
  return `${where}${way}: ${what[n.kind]}.${said}`;
}

/**
 * What every row of the strip shows for the version picked. With a version picked, every stop
 * stays where it is: the ones it doesn't use are marked off, the ones its line runs through
 * without stopping are marked as passed, and the figures are that version's runs alone. The day's
 * closures and detours mark the halves they touch whatever version is picked.
 * @param input - See {@link StripViewInput}.
 * @returns The rows, the column headings, the states on screen and the notes.
 */
export function stripView(input: StripViewInput): StripView {
  const { strip, split, version, mode } = input;
  const marks = input.marks ?? null;
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
  const present: StripPresent = {
    unserved: false,
    none: false,
    off: false,
    pass: false,
    closed: marks?.bypasses.some((b) => b.kind === "closed") ?? false,
    detour: marks?.bypasses.some((b) => b.kind === "detour") ?? false,
    suspect: marks?.bypasses.some((b) => b.kind === "suspect") ?? false,
    stub: (marks?.stubs.length ?? 0) > 0,
    announced: (marks?.announced.length ?? 0) > 0,
    starred: false,
  };

  const rows = strip.rows.map((row, i): StripRowView => {
    const stopsDown = downRows ? downRows.has(i) : row.down;
    const stopsUp = upRows ? upRows.has(i) : row.up;
    const state: RowState =
      stopsDown || stopsUp ? "on" : passes.has(i) ? "pass" : picked ? "off" : "on";
    const mark = marks?.rows[i] ?? { down: null, up: null };
    const down = side(row, stopsDown, figures, strip.down, mode, mark.down);
    const up = side(row, stopsUp, figures, strip.up, mode, mark.up);
    const served = (["down", "up"] as const).filter((s: StripSide) => row[s]);
    const struck =
      served.length > 0 && served.every((s) => mark[s]?.kind === "closed" && mark[s].allDay);
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
      if (halves.some((h) => h.tone === "unserved" || h.tone === "closed")) {
        present.unserved = true;
      }
      if (split && halves.some((h) => h.tone === "none")) present.none = true;
      if (halves.some((h) => h.text.endsWith("*"))) present.starred = true;
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
      struck,
      down,
      up,
      sentence,
    };
  });
  const notes = (marks?.notes ?? [])
    .toSorted((a, b) => a.rows[0] - b.rows[0] || a.rows[1] - b.rows[1])
    .map((n) => noteText(n, strip, downHeading, upHeading));
  return { rows, downHeading, upHeading, present, notes };
}
