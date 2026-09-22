// src/lib/strip-marks.ts
// The day's recorded stop closures and detours (lib/stop-closures.ts) placed on the route strip:
// which side of which row each one marks, the strands that go round them (rules 21-24 and 27), the
// stretches of line no run uses, and the announced detours no run has shown yet (rule 28). Pure and
// client-safe; lib/strip-view.ts words the notes.
import { bypassSpan, closedRuns, type RouteStrip, type StripSide } from "@/lib/route-strip";
import type { RouteVariant } from "@/types/api";

/** A recorded closure or detour as the diagram reads it, instants in epoch ms. */
export interface DayClosure {
  kind: "closed" | "detour";
  source: "alert" | "seen" | "skipped";
  /** The GTFS direction the runs showed it in, or null for an alert, which names none. */
  directionId: number | null;
  /** Raw stop ids an alert names, or the stop AT's feed marked skipped. */
  stopIds: string[];
  /** For a seen detour: the last stop served before it, and the first after. */
  fromStopId: string | null;
  toStopId: string | null;
  /** The alert's header, when an alert names it or was in force when runs showed it. */
  alert: string | null;
  /** How many runs showed it. */
  runs: number;
  /** A seen detour taken by enough runs to count (rule 28's trend). */
  confirmed: boolean;
  /** An announced detour enough runs drove straight through. */
  disputed: boolean;
  from: number;
  to: number | null;
}

/**
 * What marks one side of a row:
 * - `closed`: runs that way don't stop (an alert closes it, or AT's feed skipped it);
 * - `detour`: runs that way went round it, on enough runs to count;
 * - `suspect`: one or two runs went round it;
 * - `announced`: an alert names it in a detour no run has shown yet.
 */
export type MarkKind = "closed" | "detour" | "suspect" | "announced";

/** One side of a row's mark. */
export interface SideMark {
  kind: MarkKind;
  /** Whether it held for the whole day on screen (so far, on today). */
  allDay: boolean;
}

/** A strand going round rows one direction doesn't stop at, in row units. */
export interface StripBypass {
  side: StripSide;
  kind: "closed" | "detour" | "suspect";
  lane: number;
  /** The rows it leaves and rejoins the line at, or null where it starts or ends beside a row. */
  above: number | null;
  below: number | null;
  /** The rows it goes round; `lo > hi` when it goes round none (a detour between two stops). */
  lo: number;
  hi: number;
}

/** A stretch of one lane's line, in row units: `top` 2.5 is halfway between rows 2 and 3. */
export interface StripSpan {
  lane: number;
  top: number;
  bottom: number;
}

/** One closure or detour as the notes under the diagram name it. */
export interface MarkNote {
  /** The first and last row it covers; a seen detour's are the stops either side. */
  rows: [number, number];
  side: StripSide | "both";
  kind: MarkKind | "disputed";
  source: DayClosure["source"];
  /** When it started and ended inside the day, or null where it ran past the day's edge. */
  from: number | null;
  to: number | null;
  alert: string | null;
  runs: number;
}

/** Everything the day's closures and detours put on the strip. */
export interface StripMarks {
  /** Each row's marks down and up the page, by row index. */
  rows: Array<{ down: SideMark | null; up: SideMark | null }>;
  bypasses: StripBypass[];
  /** Stretches of line no run uses: under strands going round it both ways. */
  stubs: StripSpan[];
  /** Stretches of line an announced detour names, drawn over it. */
  announced: StripSpan[];
  /** Rows an alert names. */
  alertRows: number[];
  notes: MarkNote[];
}

/** What {@link stripMarks} reads. */
export interface StripMarksInput {
  strip: RouteStrip;
  /** The route view's directions, for which way each stop id is served. */
  directions: Record<number, { variants: RouteVariant[] }>;
  closures: readonly DayClosure[];
  /** Raw stop id > canonical station id. */
  rawToCanon: ReadonlyMap<string, string>;
  /** A merged direction id > the direction it was folded into. */
  directionIdAliases: ReadonlyMap<number, number>;
  /**
   * The day on screen in epoch ms. Rows get an end only once they've ended, so on today one still
   * open reads as holding so far.
   */
  day: { start: number; end: number };
}

/**
 * Whether a closure closes its stops, as rule 26's filter and the diagram's closed marks count
 * it: an alert's, or a skip enough runs showed. One run skipping a stop is a short-worked run
 * more often than a closure.
 * @param c - The closure.
 * @returns True when its stops count as closed.
 */
export function closesStops(c: DayClosure): boolean {
  return c.kind === "closed" && (c.source === "alert" || c.confirmed);
}

/** Which mark wins when two land on one side of a row. */
const RANK: Record<MarkKind, number> = { closed: 3, detour: 2, suspect: 1, announced: 0 };

/** The two sides, down the page first. */
const SIDES = ["down", "up"] as const;

/**
 * The stronger of two marks on one side of a row: the higher rank, and all day if either of that
 * kind held all day.
 * @param had - The mark already there.
 * @param m - The new one.
 * @returns The mark to keep.
 */
function stronger(had: SideMark | null, m: SideMark): SideMark {
  if (!had || RANK[m.kind] > RANK[had.kind]) return m;
  if (RANK[m.kind] < RANK[had.kind]) return had;
  return { kind: had.kind, allDay: had.allDay || m.allDay };
}

/**
 * Runs of consecutive rows on one lane, as spans half a row past each end, kept inside the line.
 * @param strip - The strip.
 * @param rows - Row indices, any order.
 * @returns The spans, top first.
 */
function spansOf(strip: RouteStrip, rows: Iterable<number>): StripSpan[] {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const last = strip.rows.length - 1;
  const spans: StripSpan[] = [];
  let lo = -1;
  sorted.forEach((i, k) => {
    if (lo < 0) lo = i;
    const next = sorted[k + 1];
    const lane = strip.rows[i]!.lane;
    if (next === i + 1 && strip.rows[next]!.lane === lane) return;
    spans.push({ lane, top: Math.max(0, lo - 0.5), bottom: Math.min(last, i + 0.5) });
    lo = -1;
  });
  return spans;
}

/**
 * Place the day's closures and detours on the strip.
 * - A closure an alert names marks its stop closed on each side whose runs use that stop id: a bus
 *   stop has a different id each way, so the id says which way it closes.
 * - A stop AT's feed skipped on enough runs is closed the way they were going; one run skipping it
 *   marks nothing.
 * - A seen detour marks the stops between the two its runs served, the way they were going, and
 *   gets a strand from one to the other. One its arrivals put in the wrong order for its direction
 *   is left off rather than drawn backwards.
 * - An announced detour marks the stops it names, and a dashed stretch over the line, unless runs
 *   showed where they went or drove straight through (disputed), which only a note says.
 * - Stops closed all day get a strand round them per direction, taking in neighbours that way never
 *   serves (rules 21-24); a part-day closure keeps its figures with a note (rule 25).
 * @param input - See {@link StripMarksInput}.
 * @returns The marks.
 */
export function stripMarks(input: StripMarksInput): StripMarks {
  const { strip, directions, closures, rawToCanon, directionIdAliases, day } = input;
  const n = strip.rows.length;
  const rows = strip.rows.map((): StripMarks["rows"][number] => ({ down: null, up: null }));
  const rowsOfStop = new Map<string, number[]>();
  strip.rows.forEach((r, i) => {
    for (const id of r.stopIds) rowsOfStop.set(id, [...(rowsOfStop.get(id) ?? []), i]);
  });
  /**
   * The side a direction reads on the strip.
   * @param dir - A GTFS direction id, merged or primary.
   * @returns The side, or null when the strip has no such direction.
   */
  const sideOfDir = (dir: number | null): StripSide | null => {
    if (dir == null) return null;
    const primary = directionIdAliases.get(dir) ?? dir;
    return strip.down.includes(primary) ? "down" : strip.up.includes(primary) ? "up" : null;
  };
  const sidesOfStop = new Map<string, Set<StripSide>>();
  for (const [dir, d] of Object.entries(directions)) {
    const side = sideOfDir(Number(dir));
    if (!side) continue;
    for (const v of d.variants) {
      for (const id of v.stopIds) sidesOfStop.set(id, (sidesOfStop.get(id) ?? new Set()).add(side));
    }
  }
  /**
   * The rows a raw stop id sits on.
   * @param id - The raw stop id.
   * @returns The row indices.
   */
  const rowsOf = (id: string): number[] => rowsOfStop.get(rawToCanon.get(id) ?? id) ?? [];

  const alertRows = new Set<number>();
  const notes: MarkNote[] = [];
  const bypasses: StripBypass[] = [];
  const seenStretches: Array<[number, number]> = [];
  const announcedRows = new Set<number>();

  /**
   * When a closure started and ended inside the day, and whether it held all of it.
   * @param c - The closure.
   * @returns Its clipped ends and whether it covered the day.
   */
  const within = (c: DayClosure): { from: number | null; to: number | null; allDay: boolean } => {
    const from = c.from <= day.start ? null : c.from;
    const to = c.to == null || c.to >= day.end ? null : c.to;
    return { from, to, allDay: from == null && to == null };
  };
  /**
   * A note for a closure, over the rows it marked.
   * @param c - The closure.
   * @param marked - The rows.
   * @param side - The side, or both.
   * @param kind - What the note says happened.
   */
  const note = (
    c: DayClosure,
    marked: number[],
    side: MarkNote["side"],
    kind: MarkNote["kind"],
  ): void => {
    if (marked.length === 0) return;
    const { from, to } = within(c);
    notes.push({
      rows: [Math.min(...marked), Math.max(...marked)],
      side,
      kind,
      source: c.source,
      from,
      to,
      alert: c.alert,
      runs: c.runs,
    });
  };

  // Seen detours first, so an announced detour the runs showed isn't also drawn along the line.
  for (const c of closures) {
    if (c.source !== "seen" || !c.fromStopId || !c.toStopId) continue;
    const side = sideOfDir(c.directionId);
    if (!side) continue;
    const a = rowsOf(c.fromStopId).find((i) => strip.rows[i]![side]);
    const b = rowsOf(c.toStopId).find((i) => strip.rows[i]![side]);
    if (a == null || b == null || a === b || a < b !== (side === "down")) continue;
    const above = Math.min(a, b);
    const below = Math.max(a, b);
    const kind = c.confirmed ? "detour" : "suspect";
    const { allDay } = within(c);
    for (let i = above + 1; i < below; i++) {
      if (strip.rows[i]![side]) rows[i]![side] = stronger(rows[i]![side], { kind, allDay });
    }
    const lane = strip.rows[above]!.lane;
    const oneLane = strip.rows.slice(above, below + 1).every((r) => r.lane === lane);
    const dupe = bypasses.find(
      (p) => p.side === side && p.above === above && p.below === below && p.kind !== "closed",
    );
    if (dupe) {
      if (kind === "detour") dupe.kind = "detour";
    } else if (oneLane) {
      bypasses.push({ side, kind, lane, above, below, lo: above + 1, hi: below - 1 });
    }
    seenStretches.push([above, below]);
    note(c, [above, below], side, kind);
  }

  for (const c of closures) {
    if (c.source === "seen") continue;
    const { allDay } = within(c);
    const marked = new Set<number>();
    const sides = new Set<StripSide>();
    if (c.kind === "closed") {
      if (!closesStops(c)) continue;
      // An alert names a stop id, which one side of the road uses; AT's feed gives the run's way.
      const runSide = c.source === "skipped" ? sideOfDir(c.directionId) : null;
      if (c.source === "skipped" && !runSide) continue;
      for (const id of c.stopIds) {
        const ways = runSide ? [runSide] : [...(sidesOfStop.get(rawToCanon.get(id) ?? id) ?? [])];
        for (const i of rowsOf(id)) {
          if (c.source === "alert") alertRows.add(i);
          for (const side of ways) {
            if (!strip.rows[i]![side]) continue;
            rows[i]![side] = stronger(rows[i]![side], { kind: "closed", allDay });
            marked.add(i);
            sides.add(side);
          }
        }
      }
      note(c, [...marked], sides.size === 2 ? "both" : ([...sides][0] ?? "both"), "closed");
      continue;
    }
    // An announced detour.
    const named = c.stopIds.flatMap(rowsOf);
    for (const i of named) alertRows.add(i);
    if (named.length === 0) continue;
    if (c.disputed) {
      note(c, named, "both", "disputed");
      continue;
    }
    if (named.every((i) => seenStretches.some(([lo, hi]) => lo <= i && i <= hi))) continue;
    for (const i of named) {
      for (const side of SIDES) {
        if (!strip.rows[i]![side]) continue;
        rows[i]![side] = stronger(rows[i]![side], { kind: "announced", allDay });
        announcedRows.add(i);
      }
    }
    note(c, named, "both", "announced");
  }

  // Strands round the stops closed all day, one per run of them each way (rules 21-24).
  for (const side of SIDES) {
    const closed = new Set(
      strip.rows
        .filter((_, i) => rows[i]![side]?.kind === "closed" && rows[i]![side].allDay)
        .map((r) => r.key),
    );
    if (closed.size === 0) continue;
    for (const [lo, hi] of closedRuns(strip.rows, side, closed)) {
      const lane = strip.rows[lo]!.lane;
      const above = lo > 0 && strip.rows[lo - 1]!.lane === lane ? lo - 1 : null;
      const below = hi < n - 1 && strip.rows[hi + 1]!.lane === lane ? hi + 1 : null;
      bypasses.push({ side, kind: "closed", lane, above, below, lo, hi });
    }
  }

  return {
    rows,
    bypasses,
    stubs: stubsOf(strip, bypasses),
    announced: spansOf(strip, announcedRows),
    alertRows: [...alertRows].sort((a, b) => a - b),
    notes,
  };
}

/**
 * The stretches of line no run uses: where strands go round it both ways, or the one way a
 * one-way route runs. Detours a run or two took leave the line in use, so they never make one.
 * @param strip - The strip.
 * @param bypasses - The strands.
 * @returns The stretches, top first.
 */
function stubsOf(strip: RouteStrip, bypasses: readonly StripBypass[]): StripSpan[] {
  const sure = bypasses.filter((b) => b.kind !== "suspect");
  const twoWay = strip.down.length > 0 && strip.up.length > 0;
  const stubs: StripSpan[] = [];
  for (const d of sure.filter((b) => b.side === "down" || !twoWay)) {
    const a = bypassSpan(d);
    if (!twoWay) {
      stubs.push(a);
      continue;
    }
    for (const u of sure.filter((b) => b.side === "up" && b.lane === d.lane)) {
      const o = bypassSpan(u);
      const top = Math.max(a.top, o.top);
      const bottom = Math.min(a.bottom, o.bottom);
      if (bottom > top) stubs.push({ lane: d.lane, top, bottom });
    }
  }
  return stubs.sort((a, b) => a.top - b.top);
}
