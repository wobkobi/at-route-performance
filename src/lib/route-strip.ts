// src/lib/route-strip.ts
// A route laid out as one strip map: both directions merged into one list of stops down the page,
// the version reaching the most stops on a straight line, and every stop only other versions reach
// on a track beside it. Pure and client-safe, with plain JSON out (no Map or Set), since the diagram
// is partly a client component. The line's geometry is built here too, once: every piece is drawn
// exactly once, carries the versions that run along it, and meets its neighbours exactly.
import type { StopFigure, StopFigures, VersionVariant } from "@/lib/stop-split";
import type { StripBypass, StripMarks, StripSpan } from "@/lib/strip-marks";
import type { RouteVariant } from "@/types/api";

/** Height of one stop's row (px). */
export const STRIP_ROW = 32;
/**
 * Gap between neighbouring tracks (px). A step from one track to the next is drawn at 45 degrees,
 * so it takes this much height too, which has to stay under {@link STRIP_ROW}.
 */
export const STRIP_LANE = 24;
/** How far a loop's line runs on past its last stop before it turns back (px). */
export const LOOP_STUB = 6;
/**
 * How far a strand going round a closed stop or a detour runs out from the line (px): its 4px
 * stroke clears a stop's ring, and on the right it stays clear of a track a lane over.
 */
export const BYPASS_OFF = 14;
/** A version carrying less than this share of the route's runs is minor: listed, with no chip. */
export const MINOR_SHARE = 0.05;
/** Stops sharing a name this close together are one stop, one on each side of the road (metres). */
const SAME_STOP_M = 400;
/** How much two groups' stop names must overlap (Jaccard) to pair them as one version's two ways. */
const PAIR_OVERLAP = 0.5;
/** Metres per degree of latitude (close enough anywhere at city scale). */
const M_PER_DEG = 111_320;

/** Which way a direction reads on the strip: down the page (the first figure column) or up it. */
export type StripSide = "down" | "up";

/** What the strip is built from: a route view's directions, stop names and positions. */
export interface StripInput {
  directions: Record<number, { variants: RouteVariant[] }>;
  /** Canonical stop id > name. */
  names: ReadonlyMap<string, string>;
  /** Canonical stop id > `[lat, lon]`. */
  coords: ReadonlyMap<string, readonly [number, number]>;
}

/** One stop on the strip, in order down the page. */
export interface StripRow {
  /** The first stop id merged into the row, or `<id>~end` for the last stop of a circuit. */
  key: string;
  /** Every canonical stop id merged into the row: usually one per side of the road. */
  stopIds: string[];
  name: string;
  /** The track the stop sits on: 0 is the straight line, 1 and up sit to its right. */
  lane: number;
  /** Whether a run reading down the page stops here. */
  down: boolean;
  /** Whether a run reading up the page stops here. */
  up: boolean;
  /** Where a version starts or ends, or a track ends: a bigger ring and a bold name. */
  terminus: boolean;
  /** For the last stop of a circuit, the key of the first row, which it repeats; else null. */
  repeats: string | null;
  /** The furthest-out lane any line reaches beside this row, so its name clears the drawing. */
  reach: number;
}

/** A variant as a version carries it: enough to place a run on it, without its stop list. */
export interface StripVariant extends VersionVariant {
  tripCount: number;
}

/** A version: the runs that share a start and an end, in both directions. */
export interface StripVersion {
  /** Stable within the route's schedule, built from the names of its ends. */
  key: string;
  /** Where it starts and ends, read in its first direction: "Coyle Park" to "Glen Innes Station". */
  from: string;
  to: string;
  /**
   * Where its runs reading down the page end, and those reading up it, or null when it has none
   * that way or they end in different places. Not always `to` and `from`: OUT runs St Lukes to
   * Westfield Newmarket, and back from Mahuru Street.
   */
  downTo: string | null;
  upTo: string | null;
  /** Which way round its runs go each way, from their headsigns, for a circuit run both ways. */
  downWay: string | null;
  upWay: string | null;
  tripCount: number;
  /** Under {@link MINOR_SHARE} of the route's runs: listed under the diagram, with no chip. */
  minor: boolean;
  variants: StripVariant[];
  /** Rows its runs stop at reading down the page, and reading up it. */
  downRows: number[];
  upRows: number[];
  /** Rows its line runs through without stopping, drawn as an open ring when it is picked. */
  passes: number[];
}

/** A stretch of line between two rows, and the versions that run along it. */
export interface StripEdge {
  /** The upper row. */
  from: number;
  /** The lower row. */
  to: number;
  versions: string[];
  /**
   * For a loop's way back, from its last stop (`to`) up to the stop it loops back to (`from`): the
   * lane it returns on. Null for an ordinary stretch.
   */
  loopLane: number | null;
}

/** A route laid out as one strip. */
export interface RouteStrip {
  rows: StripRow[];
  /** The route's versions: every other one after the ones with chips, top of the strip first. */
  versions: StripVersion[];
  edges: StripEdge[];
  /** The version on the straight line, or null for an empty strip. */
  trunk: string | null;
  /** Direction ids read down the page (the first figure column) and up it (the second). */
  down: number[];
  up: number[];
  /** Where every chip-worthy run reading each way ends, or null when they end in different places. */
  downTo: string | null;
  upTo: string | null;
  /** Which way round every chip-worthy run reading each way goes: "Clockwise", or null. */
  downWay: string | null;
  upWay: string | null;
  /** How many lanes the strip uses: 1 for a plain line. */
  lanes: number;
}

/**
 * What a piece of line shows beyond the timetabled road (rule 29):
 * - `closed`: a strand going round a stop closed that way;
 * - `detour`, `suspect`: a strand going round stops a detour skipped, on enough runs to count or
 *   on one or two;
 * - `stub`: the line where no run went, under strands going round it both ways;
 * - `announced`: the stretch an announced detour names, over the line.
 */
export type SegmentMark = "closed" | "detour" | "suspect" | "stub" | "announced";

/** One piece of line in the strip's own frame: x from the lane, y from the row. */
export interface StripSegment {
  /** A straight line from (x1, y1) to (x2, y2), y1 < y2, or a half circle turning a loop back. */
  kind: "line" | "arc";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** An arc's radius and SVG sweep flag, for a half circle drawn from (x1, y1) to (x2, y2). */
  arc?: { r: number; sweep: 0 | 1 };
  versions: string[];
  /** What it shows beyond the timetabled road; absent on the line itself. */
  mark?: SegmentMark;
}

/** One drawable piece of a column's line: an SVG path and the versions that run along it. */
export interface StripPiece {
  d: string;
  versions: string[];
  /** Where the path starts and ends, in the column's frame. */
  from: [number, number];
  to: [number, number];
  mark?: SegmentMark;
}

/** The day's closures and detours as the geometry draws them, from `stripMarks`. */
export type StripOverlay = Pick<StripMarks, "bypasses" | "stubs" | "announced">;

/** One column of a laid-out strip, in its own frame. */
export interface StripColumn {
  /** Each row's ring centre. */
  rows: Array<{ index: number; x: number; y: number }>;
  pieces: StripPiece[];
  /** The lowest point any line or ring centre reaches. */
  bottom: number;
}

/** Where a column's drawing sits in its frame. */
export interface StripDims {
  /** The first row's ring centre, down from the column's top (px). */
  top: number;
  /** The straight line's x, in from the column's left (px). */
  left: number;
  /** How far the line runs on past a column break, above or below (px). */
  tail: number;
}

/** A stop before it has a row: the ids merged into it and its name. */
interface StopNode {
  key: string;
  stopIds: string[];
  name: string;
  /** The node this one repeats: the start of a circuit, for its last stop. */
  repeats: string | null;
}

/** One variant's run as the strip reads it: node keys in order down the page. */
interface Seq {
  variant: RouteVariant;
  side: StripSide;
  nodes: string[];
  /** Where it ends in a loop: the stop it loops back to, and the stops round the loop. */
  loop: { anchor: string; stops: string[] } | null;
  /** The nodes it starts and ends at, down the page: a loop ends at its anchor. */
  ends: [string, string];
}

/** Variants in one direction that start and end at the same names. */
interface Group {
  side: StripSide;
  from: string;
  to: string;
  seqs: Seq[];
  trips: number;
  /** Every stop name it serves, for pairing by overlap. */
  names: Set<string>;
}

/** A version while the strip is built. */
interface Draft {
  key: string;
  from: string;
  to: string;
  trips: number;
  minor: boolean;
  seqs: Seq[];
}

/**
 * A run of stops one version reaches and nothing placed before it does, and where it attaches.
 * - `head`: nothing before it; it runs into `join`.
 * - `tail`: nothing after it; it runs on from `leave`.
 * - `middle`: it leaves at `leave` and rejoins at `join`.
 * - `loose`: it shares no stop with anything placed.
 */
interface Run {
  kind: "head" | "tail" | "middle" | "loose";
  keys: string[];
  leave: string | null;
  join: string | null;
}

/** A track while lanes are handed out: the lane and the rows at its two ends. */
interface Track {
  lane: number;
  top: string;
  bottom: string;
}

/**
 * Metres between two points, on a flat projection around the first (ample at city scale).
 * @param a - `[lat, lon]`.
 * @param b - `[lat, lon]`.
 * @returns The distance in metres.
 */
function metresBetween(a: readonly [number, number], b: readonly [number, number]): number {
  const cosLat = Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * M_PER_DEG, (b[1] - a[1]) * M_PER_DEG * cosLat);
}

/**
 * A stop name as compared: case and spacing ignored.
 * @param name - The name.
 * @returns The comparable form.
 */
function normName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * A name as a key: lower case, with every run of other characters a single hyphen.
 * @param text - The name.
 * @returns The slug.
 */
function slug(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Drop each key that repeats the one before it.
 * @param keys - Keys in order.
 * @returns The keys with consecutive repeats collapsed.
 */
function collapse(keys: readonly string[]): string[] {
  const out: string[] = [];
  for (const k of keys) if (out.at(-1) !== k) out.push(k);
  return out;
}

/**
 * The item with the highest score, the first one on a tie.
 * @param items - The items.
 * @param score - Scores an item.
 * @returns The best item, or undefined for none.
 */
function maxBy<T>(items: readonly T[], score: (t: T) => number): T | undefined {
  let best: T | undefined;
  let top = -Infinity;
  for (const t of items) {
    const s = score(t);
    if (s > top) {
      best = t;
      top = s;
    }
  }
  return best;
}

/**
 * Merge the route's stops into nodes, one per place. A bus stop has a different id on each side of
 * the road, so stops sharing a name within {@link SAME_STOP_M} of each other are one node; stops
 * with no position merge by name alone. Stops paired across the road under different names stay
 * apart. A node is keyed by the first id met, reading the variants in the order given.
 * @param variants - Every variant, lowest direction first.
 * @param input - Names and positions.
 * @returns Each stop id's node key, and the nodes.
 */
function buildNodes(
  variants: readonly RouteVariant[],
  input: StripInput,
): { nodeOf: Map<string, string>; nodes: Map<string, StopNode> } {
  const nodeOf = new Map<string, string>();
  const nodes = new Map<string, StopNode>();
  const byName = new Map<string, StopNode[]>();
  for (const v of variants) {
    for (const id of v.stopIds) {
      if (nodeOf.has(id)) continue;
      const name = input.names.get(id) ?? id;
      const here = input.coords.get(id);
      const same = byName.get(normName(name)) ?? [];
      const hit = same.find((n) =>
        n.stopIds.some((o) => {
          const there = input.coords.get(o);
          return !here || !there || metresBetween(here, there) <= SAME_STOP_M;
        }),
      );
      if (hit) {
        hit.stopIds.push(id);
        nodeOf.set(id, hit.key);
        continue;
      }
      const node: StopNode = { key: id, stopIds: [id], name, repeats: null };
      nodes.set(id, node);
      nodeOf.set(id, id);
      byName.set(normName(name), [...same, node]);
    }
  }
  return { nodeOf, nodes };
}

/**
 * How far two node lists agree on the order of the nodes they share: positive when mostly in the
 * same order, negative when mostly reversed. Each node counts at its first visit.
 * @param ref - The list read down the page.
 * @param other - The list to compare.
 * @returns Pairs in the same order less pairs reversed.
 */
function orderScore(ref: readonly string[], other: readonly string[]): number {
  const at = new Map<string, number>();
  ref.forEach((k, i) => {
    if (!at.has(k)) at.set(k, i);
  });
  const seen = new Set<string>();
  const pos: number[] = [];
  for (const k of other) {
    const i = at.get(k);
    if (i === undefined || seen.has(k)) continue;
    seen.add(k);
    pos.push(i);
  }
  let score = 0;
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) score += Math.sign(pos[j]! - pos[i]!);
  }
  return score;
}

/**
 * Whether a run read down the page loops at an end: at the end when its last stop repeats an
 * earlier one (S-C round the city and back into Newmarket), at the start when its first stop
 * repeats a later one. A run that starts and ends at the same stop is a circuit, not a loop.
 * @param ns - Node keys down the page, consecutive repeats collapsed.
 * @returns Which end loops, or null.
 */
function loopEnd(ns: readonly string[]): "start" | "end" | null {
  const first = ns[0];
  const last = ns.at(-1);
  if (ns.length < 3 || first === undefined || last === undefined || first === last) return null;
  if (ns.lastIndexOf(last, ns.length - 2) > 0) return "end";
  if (ns.indexOf(first, 1) > 0) return "start";
  return null;
}

/**
 * Cut a run into the list the strip places.
 * - A run ending at a circuit's start ends on that stop's second row instead (`<key>~end`), so the
 *   circuit draws as a line whose last row repeats its first.
 * - A run ending in a loop drops the repeat and records the loop, whose way back the strip draws.
 * - Any other stop visited twice keeps its first visit (INN's Westfield Newmarket, either side of
 *   Clovernook Road).
 * @param ns - Node keys down the page, consecutive repeats collapsed.
 * @param circuits - The nodes some circuit starts and ends at.
 * @returns The nodes, the loop and the two ends.
 */
function cutSeq(
  ns: readonly string[],
  circuits: ReadonlySet<string>,
): Pick<Seq, "nodes" | "loop" | "ends"> {
  const last = ns.at(-1)!;
  let body = [...ns];
  let loop: Seq["loop"] = null;
  let end: string | null = null;
  if (circuits.has(last)) {
    body = ns.slice(0, -1);
    end = `${last}~end`;
  } else if (ns.lastIndexOf(last, ns.length - 2) > 0) {
    const i = ns.lastIndexOf(last, ns.length - 2);
    loop = { anchor: last, stops: ns.slice(i + 1, -1) };
    body = ns.slice(0, -1);
  }
  const seen = new Set<string>();
  const nodes: string[] = [];
  for (const k of body) {
    if (seen.has(k)) continue;
    seen.add(k);
    nodes.push(k);
  }
  if (end) nodes.push(end);
  if (loop) loop.stops = [...new Set(loop.stops)].filter((k) => k !== loop.anchor);
  return { nodes, loop, ends: [nodes[0]!, end ?? loop?.anchor ?? nodes.at(-1)!] };
}

/**
 * Read every variant as a run down the page. The lowest direction reads down; any other reads down
 * or up by the order it passes the stops they share, and an up run is reversed. When runs loop at
 * their start rather than their end, every run is turned over, so a loop always hangs off the foot
 * of the strip.
 * @param dirIds - Direction ids, lowest first.
 * @param input - The route.
 * @param nodeOf - Each stop id's node.
 * @param nodes - The nodes; a circuit's second row for its start is added here.
 * @returns The runs, and each direction's side.
 */
function readSeqs(
  dirIds: readonly number[],
  input: StripInput,
  nodeOf: ReadonlyMap<string, string>,
  nodes: Map<string, StopNode>,
): { seqs: Seq[]; sideOf: Map<number, StripSide> } {
  /**
   * A variant's stops as node keys, consecutive repeats collapsed.
   * @param v - The variant.
   * @returns The keys, in the variant's own order.
   */
  const keysOf = (v: RouteVariant): string[] =>
    collapse(v.stopIds.map((id) => nodeOf.get(id) ?? id));
  /**
   * A direction's busiest variant.
   * @param d - The direction id.
   * @returns The variant, or undefined for an empty direction.
   */
  const busiest = (d: number): RouteVariant | undefined =>
    maxBy(input.directions[d]?.variants ?? [], (v) => v.tripCount);

  const sideOf = new Map<number, StripSide>();
  const ref = busiest(dirIds[0]!);
  for (const d of dirIds) {
    const v = busiest(d);
    const down = d === dirIds[0] || (!!ref && !!v && orderScore(keysOf(ref), keysOf(v)) > 0);
    sideOf.set(d, down ? "down" : "up");
  }

  let raw = dirIds.flatMap((d) =>
    (input.directions[d]?.variants ?? []).map((variant) => {
      const side = sideOf.get(d)!;
      const ns = keysOf(variant);
      return { variant, side, ns: side === "up" ? ns.reverse() : ns };
    }),
  );
  let starts = 0;
  let ends = 0;
  for (const r of raw) {
    const at = loopEnd(r.ns);
    if (at === "start") starts += r.variant.tripCount;
    if (at === "end") ends += r.variant.tripCount;
  }
  if (starts > ends) {
    for (const [d, s] of sideOf) sideOf.set(d, s === "down" ? "up" : "down");
    raw = raw.map((r) => ({
      ...r,
      side: r.side === "down" ? ("up" as const) : ("down" as const),
      ns: [...r.ns].reverse(),
    }));
  }

  const circuits = new Set(
    raw.filter((r) => r.ns.length >= 3 && r.ns[0] === r.ns.at(-1)).map((r) => r.ns[0]!),
  );
  for (const c of circuits) {
    const start = nodes.get(c)!;
    nodes.set(`${c}~end`, { ...start, key: `${c}~end`, repeats: c });
  }
  const seqs = raw
    .filter((r) => r.ns.length >= 2)
    .map((r) => ({ variant: r.variant, side: r.side, ...cutSeq(r.ns, circuits) }))
    .filter((s) => s.nodes.length >= 2);
  // Down runs first, busiest first within a side: the order ties break in, all through the build.
  seqs.sort(
    (a, b) =>
      Number(a.side === "up") - Number(b.side === "up") ||
      b.variant.tripCount - a.variant.tripCount,
  );
  return { seqs, sideOf };
}

/**
 * Jaccard overlap of two sets.
 * @param a - One set.
 * @param b - The other.
 * @returns Shared members over all members, 0 for two empty sets.
 */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const all = a.size + b.size - shared;
  return all === 0 ? 0 : shared / all;
}

/**
 * Group the runs into versions. Runs in one direction with the same first and last stop names are
 * one group; stop ids can't be compared, since the ends differ by direction (Coyle Park is 8000
 * out and 8001 back). A down group pairs with an up group, busiest first, by the first test that
 * finds one:
 * - its ends' names reversed;
 * - its ends' names as they are, which only a circuit's short runs give (INN's two from K Rd);
 * - one end shared and the stop names overlapping at {@link PAIR_OVERLAP} or more, the most first
 *   (OUT runs St Lukes to Westfield Newmarket, and back from Mahuru Street). Without the shared end,
 *   INN's short runs from K Rd one way and Queens Arcade the other would pair.
 * @param seqs - The runs.
 * @param input - Stop names.
 * @returns The versions, busiest first.
 */
function groupVersions(seqs: readonly Seq[], input: StripInput): Draft[] {
  /**
   * A stop's name.
   * @param id - Stop id.
   * @returns Its name, or the id when it has none.
   */
  const nameOf = (id: string | undefined): string => (id ? (input.names.get(id) ?? id) : "");
  const groups = new Map<string, Group>();
  for (const s of seqs) {
    const from = nameOf(s.variant.stopIds[0]);
    const to = nameOf(s.variant.stopIds.at(-1));
    const key = `${s.side}|${normName(from)}|${normName(to)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { side: s.side, from, to, seqs: [], trips: 0, names: new Set() }));
    g.seqs.push(s);
    g.trips += s.variant.tripCount;
    for (const id of s.variant.stopIds) g.names.add(normName(nameOf(id)));
  }
  const all = [...groups.values()].sort((a, b) => b.trips - a.trips);
  const downs = all.filter((g) => g.side === "down");
  const ups = all.filter((g) => g.side === "up");
  /**
   * Whether two names are the same stop's.
   * @param a - One name.
   * @param b - The other.
   * @returns True when they match, case and spacing ignored.
   */
  const same = (a: string, b: string): boolean => normName(a) === normName(b);
  const tests: Array<(d: Group, u: Group) => boolean> = [
    (d, u) => same(u.from, d.to) && same(u.to, d.from),
    (d, u) => same(u.from, d.from) && same(u.to, d.to),
  ];
  const partner = new Map<Group, Group>();
  const taken = new Set<Group>();
  for (const test of tests) {
    for (const d of downs) {
      if (partner.has(d)) continue;
      const u = ups.find((x) => !taken.has(x) && test(d, x));
      if (u) {
        partner.set(d, u);
        taken.add(u);
      }
    }
  }
  for (const d of downs) {
    if (partner.has(d)) continue;
    const u = maxBy(
      ups.filter(
        (x) =>
          !taken.has(x) &&
          (same(x.to, d.from) || same(x.from, d.to)) &&
          jaccard(d.names, x.names) >= PAIR_OVERLAP,
      ),
      (x) => jaccard(d.names, x.names) * 1e6 + x.trips,
    );
    if (u) {
      partner.set(d, u);
      taken.add(u);
    }
  }

  const total = all.reduce((n, g) => n + g.trips, 0);
  const keys = new Set<string>();
  const drafts: Draft[] = [];
  for (const g of all) {
    if (taken.has(g)) continue;
    const u = partner.get(g);
    const trips = g.trips + (u?.trips ?? 0);
    let key = slug(`${g.from} to ${g.to}`) || "version";
    for (let n = 2; keys.has(key); n++) key = `${slug(`${g.from} to ${g.to}`)}-${n}`;
    keys.add(key);
    drafts.push({
      key,
      from: g.from,
      to: g.to,
      trips,
      minor: trips < MINOR_SHARE * total,
      seqs: [...g.seqs, ...(u?.seqs ?? [])],
    });
  }
  return drafts.sort((a, b) => b.trips - a.trips);
}

/**
 * Merge several runs' stop lists into one order that keeps each run's own order. A topological
 * sort (Kahn's algorithm) over the steps between consecutive stops; among the stops ready to place,
 * the one met first wins, reading the runs in the order given and each from its start. So with
 * down runs listed first, a stop only a down run serves sits above its partner across the road
 * that only an up run serves (Potters Park above Balmoral Road/Dominion Road). Where the runs
 * disagree and leave a cycle, the stop met first is forced in.
 * @param seqs - Node keys per run, each visiting a stop at most once.
 * @returns Every key once, in order.
 */
export function mergeOrder(seqs: ReadonlyArray<readonly string[]>): string[] {
  const rank = new Map<string, number>();
  for (const seq of seqs) for (const k of seq) if (!rank.has(k)) rank.set(k, rank.size);
  const next = new Map<string, Set<string>>();
  const waiting = new Map<string, number>();
  for (const k of rank.keys()) {
    next.set(k, new Set());
    waiting.set(k, 0);
  }
  for (const seq of seqs) {
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1]!;
      const b = seq[i]!;
      if (a === b || next.get(a)!.has(b)) continue;
      next.get(a)!.add(b);
      waiting.set(b, waiting.get(b)! + 1);
    }
  }
  const out: string[] = [];
  const done = new Set<string>();
  while (out.length < rank.size) {
    let pick: string | null = null;
    let forced: string | null = null;
    for (const k of rank.keys()) {
      if (done.has(k)) continue;
      forced ??= k;
      if (waiting.get(k) === 0) {
        pick = k;
        break;
      }
    }
    const k = pick ?? forced!;
    done.add(k);
    out.push(k);
    for (const n of next.get(k)!) waiting.set(n, waiting.get(n)! - 1);
  }
  return out;
}

/**
 * Place every stop in rows. The trunk's two runs are merged first. Then each other version, busiest
 * first, merges its own runs, and each stretch of stops nothing placed yet serves goes in beside
 * where it attaches: a head straight before the stop it runs into, a tail straight after the stop
 * it leaves, a stretch in the middle straight before the stop it rejoins at.
 * @param trunk - The trunk's merged order.
 * @param units - Each other version's runs, busiest first.
 * @returns Node keys in row order, and the runs that were added.
 */
function placeRows(
  trunk: readonly string[],
  units: ReadonlyArray<readonly Seq[]>,
): { order: string[]; runs: Run[] } {
  const order = [...trunk];
  const placed = new Set(order);
  const runs: Run[] = [];
  for (const seqs of units) {
    const vo = mergeOrder(seqs.map((s) => s.nodes));
    let i = 0;
    while (i < vo.length) {
      if (placed.has(vo[i]!)) {
        i++;
        continue;
      }
      let j = i;
      while (j < vo.length && !placed.has(vo[j]!)) j++;
      const keys = vo.slice(i, j);
      const leave = vo[i - 1] ?? null;
      const join = vo[j] ?? null;
      const at =
        join !== null
          ? order.indexOf(join)
          : leave !== null
            ? order.indexOf(leave) + 1
            : order.length;
      order.splice(at, 0, ...keys);
      for (const k of keys) placed.add(k);
      const kind =
        leave !== null && join !== null
          ? "middle"
          : join !== null
            ? "head"
            : leave !== null
              ? "tail"
              : "loose";
      runs.push({ kind, keys, leave, join });
      i = j;
    }
  }
  return { order, runs };
}

/**
 * Hand out lanes. The trunk is lane 0. A head run into the top of a track, or a tail run off its
 * bottom, carries that track on (Selwyn Village's stops go above Walker Park, on its track, and a
 * head into the trunk's first row just extends the straight line). Every other run takes the
 * lowest lane from 1 up that is free over the rows it spans, in half rows: a track leaving a row
 * and one arriving at it can share a lane.
 * @param trunk - The trunk's keys.
 * @param runs - The added runs, in the order they were placed.
 * @param rowOf - Each key's row.
 * @returns Each key's lane, and a test for whether a lane is free over a span.
 */
function assignLanes(
  trunk: readonly string[],
  runs: readonly Run[],
  rowOf: ReadonlyMap<string, number>,
): { laneOf: Map<string, number>; claim: (min: number, lo: number, hi: number) => number } {
  const laneOf = new Map<string, number>();
  const trackOf = new Map<string, Track>();
  const occupied = new Map<number, Array<[number, number]>>();
  /**
   * Whether a lane is free over a span.
   * @param lane - The lane.
   * @param lo - First half row.
   * @param hi - Last half row.
   * @returns True when nothing on the lane overlaps the span.
   */
  const free = (lane: number, lo: number, hi: number): boolean =>
    !(occupied.get(lane) ?? []).some(([a, b]) => a <= hi && lo <= b);
  /**
   * Take the lowest free lane from `min` up over a span.
   * @param min - The lowest lane allowed.
   * @param lo - First half row.
   * @param hi - Last half row.
   * @returns The lane.
   */
  const claim = (min: number, lo: number, hi: number): number => {
    let lane = Math.max(1, min);
    while (!free(lane, lo, hi)) lane++;
    occupied.set(lane, [...(occupied.get(lane) ?? []), [lo, hi]]);
    return lane;
  };

  if (trunk.length > 0) {
    const t: Track = { lane: 0, top: trunk[0]!, bottom: trunk.at(-1)! };
    for (const k of trunk) {
      laneOf.set(k, 0);
      trackOf.set(k, t);
    }
  }
  for (const run of runs) {
    const rows = run.keys.map((k) => rowOf.get(k)!);
    const leave = run.leave === null ? null : rowOf.get(run.leave)!;
    const join = run.join === null ? null : rowOf.get(run.join)!;
    let lo = 2 * Math.min(...rows);
    let hi = 2 * Math.max(...rows);
    let attach: Track | undefined;
    if (run.kind === "head") {
      hi = 2 * join! - 1;
      const t = trackOf.get(run.join!);
      if (t?.top === run.join) attach = t;
    } else if (run.kind === "tail") {
      lo = 2 * leave! + 1;
      const t = trackOf.get(run.leave!);
      if (t?.bottom === run.leave) attach = t;
    } else if (run.kind === "middle") {
      lo = 2 * Math.min(leave!, join!) + 1;
      hi = 2 * Math.max(leave!, join!) - 1;
    }
    let track: Track;
    if (attach && (attach.lane === 0 || free(attach.lane, lo, hi))) {
      track = attach;
      if (run.kind === "head") track.top = run.keys[0]!;
      else track.bottom = run.keys.at(-1)!;
      if (track.lane > 0) occupied.set(track.lane, [...(occupied.get(track.lane) ?? []), [lo, hi]]);
    } else {
      track = { lane: claim(1, lo, hi), top: run.keys[0]!, bottom: run.keys.at(-1)! };
    }
    for (const k of run.keys) {
      laneOf.set(k, track.lane);
      trackOf.set(k, track);
    }
  }
  return { laneOf, claim };
}

/**
 * The raw segments of one stretch, before overlapping ones are merged.
 * - Same lane: a vertical.
 * - Into a lower lane: a vertical, then 45 degrees into the lower row.
 * - Out to a higher lane: 45 degrees out of the upper row, then a vertical.
 * - A loop's way back: on past its last stop by {@link LOOP_STUB}, a half circle out to the loop's
 *   lane, up to just below the stop it loops back to, then 45 degrees into it.
 * A step too short for 45 degrees (two lanes over between neighbouring rows) goes straight across.
 * @param e - The stretch.
 * @param rows - The rows.
 * @returns The segments, each carrying the stretch's versions.
 */
function edgeSegments(e: StripEdge, rows: readonly StripRow[]): StripSegment[] {
  const xa = rows[e.from]!.lane * STRIP_LANE;
  const ya = e.from * STRIP_ROW;
  const xb = rows[e.to]!.lane * STRIP_LANE;
  const yb = e.to * STRIP_ROW;
  /**
   * A straight segment, dropped when it has no length.
   * @param x1 - Start x.
   * @param y1 - Start y.
   * @param x2 - End x.
   * @param y2 - End y.
   * @returns The segment, or none.
   */
  const line = (x1: number, y1: number, x2: number, y2: number): StripSegment[] =>
    y1 === y2 && x1 === x2 ? [] : [{ kind: "line", x1, y1, x2, y2, versions: e.versions }];

  if (e.loopLane !== null) {
    const xr = e.loopLane * STRIP_LANE;
    const turn = yb + LOOP_STUB;
    const back = ya + (xr - xa);
    return [
      ...line(xb, yb, xb, turn),
      {
        kind: "arc",
        x1: xb,
        y1: turn,
        x2: xr,
        y2: turn,
        arc: { r: (xr - xb) / 2, sweep: 0 },
        versions: e.versions,
      },
      ...line(xr, back, xr, turn),
      ...line(xr, back, xa, ya),
    ];
  }
  if (xa === xb) return line(xa, ya, xb, yb);
  const step = Math.abs(xa - xb);
  if (yb - ya < step) return line(xa, ya, xb, yb);
  return xa > xb
    ? [...line(xa, ya, xa, yb - step), ...line(xa, yb - step, xb, yb)]
    : [...line(xa, ya, xb, ya + step), ...line(xb, ya + step, xb, yb)];
}

/**
 * The line a straight segment lies on, so collinear segments can be merged: verticals by x, 45
 * degree diagonals by their intercept, anything else by its own ends.
 * @param s - The segment.
 * @returns A key shared by every segment on the same line.
 */
function lineKey(s: StripSegment): string {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  if (dx === 0) return `v${s.x1}`;
  if (dx === dy) return `p${s.x1 - s.y1}`;
  if (dx === -dy) return `n${s.x1 + s.y1}`;
  return `s${s.x1},${s.y1},${s.x2},${s.y2}`;
}

/**
 * Merge overlapping segments so each stretch of line is drawn once. Segments on one line are cut
 * at every end, each piece takes the union of the versions over it, and neighbours carrying the
 * same versions join up again. Identical arcs merge the same way. Segments with different marks
 * never merge: a strand stepping back in can lie along a track's join, and stays its own piece.
 * @param raw - Segments per stretch, each with that stretch's versions.
 * @param rank - Each version's place in the strip's list, to keep version lists in one order.
 * @returns Segments that never overlap, top first.
 */
function unionSegments(
  raw: readonly StripSegment[],
  rank: ReadonlyMap<string, number>,
): StripSegment[] {
  /**
   * Versions in the strip's order, once each.
   * @param vs - Version keys.
   * @returns The sorted keys.
   */
  const sorted = (vs: Iterable<string>): string[] =>
    [...new Set(vs)].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  const lines = new Map<string, StripSegment[]>();
  const arcs = new Map<string, StripSegment>();
  for (const s of raw) {
    if (s.kind === "arc") {
      const key = `${s.x1},${s.y1},${s.x2},${s.y2},${s.arc?.r},${s.arc?.sweep}`;
      const had = arcs.get(key);
      arcs.set(key, had ? { ...had, versions: sorted([...had.versions, ...s.versions]) } : s);
      continue;
    }
    // Every straight segment runs downward: y1 < y2.
    const down = s.y1 < s.y2 ? s : { ...s, x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 };
    const key = `${down.mark ?? ""}:${lineKey(down)}`;
    lines.set(key, [...(lines.get(key) ?? []), down]);
  }

  const out: StripSegment[] = [...arcs.values()];
  for (const segs of lines.values()) {
    const ref = segs[0]!;
    const mark = ref.mark ? { mark: ref.mark } : {};
    /**
     * The line's x at a height.
     * @param y - The height.
     * @returns The x.
     */
    const xAt = (y: number): number =>
      ref.x1 + ((y - ref.y1) * (ref.x2 - ref.x1)) / (ref.y2 - ref.y1);
    const cuts = [...new Set(segs.flatMap((s) => [s.y1, s.y2]))].sort((a, b) => a - b);
    let open: StripSegment | null = null;
    for (let k = 1; k < cuts.length; k++) {
      const p = cuts[k - 1]!;
      const q = cuts[k]!;
      const vs = sorted(segs.filter((s) => s.y1 <= p && s.y2 >= q).flatMap((s) => s.versions));
      if (open && open.y2 === p && vs.length > 0 && open.versions.join("|") === vs.join("|")) {
        open.y2 = q;
        open.x2 = xAt(q);
        continue;
      }
      if (open) out.push(open);
      open =
        vs.length > 0
          ? { kind: "line", x1: xAt(p), y1: p, x2: xAt(q), y2: q, versions: vs, ...mark }
          : null;
    }
    if (open) out.push(open);
  }
  return out.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1 || a.y2 - b.y2 || a.x2 - b.x2);
}

/**
 * The versions whose line runs along a stretch of one lane, for a strand or an overlay there to
 * dim with. Every version when none does, so a mark is never left carrying nothing.
 * @param strip - The strip.
 * @param span - The stretch.
 * @returns The version keys.
 */
function versionsAlong(
  strip: Pick<RouteStrip, "rows" | "edges" | "versions">,
  span: StripSpan,
): string[] {
  const vs = strip.edges
    .filter(
      (e) =>
        e.loopLane === null &&
        strip.rows[e.from]!.lane === span.lane &&
        strip.rows[e.to]!.lane === span.lane &&
        Math.min(e.to, span.bottom) > Math.max(e.from, span.top),
    )
    .flatMap((e) => e.versions);
  return vs.length > 0 ? [...new Set(vs)] : strip.versions.map((v) => v.key);
}

/**
 * The stretch of line a strand leaves: from the row it steps off at to the row it rejoins, or half
 * a row past the rows it goes round where it has no such row.
 * @param b - The strand.
 * @returns Its span, in row units.
 */
export function bypassSpan(b: StripBypass): StripSpan {
  return { lane: b.lane, top: b.above ?? b.lo - 0.5, bottom: b.below ?? b.hi + 0.5 };
}

/**
 * A strand going round rows one direction doesn't stop at (rules 21 and 27): 45 degrees out of the
 * row above to {@link BYPASS_OFF} on that direction's side (left for the first column, right for
 * the second), straight down past the rows, and 45 degrees back into the row below. With no row
 * to leave or rejoin at, it starts or ends half a row past the rows it goes round.
 * @param b - The strand.
 * @param versions - The versions whose line it leaves.
 * @returns Its segments.
 */
function bypassSegments(b: StripBypass, versions: string[]): StripSegment[] {
  const xl = b.lane * STRIP_LANE;
  const xs = xl + (b.side === "down" ? -BYPASS_OFF : BYPASS_OFF);
  const top = b.above != null ? b.above * STRIP_ROW + BYPASS_OFF : (b.lo - 0.5) * STRIP_ROW;
  const bottom = b.below != null ? b.below * STRIP_ROW - BYPASS_OFF : (b.hi + 0.5) * STRIP_ROW;
  const mark = b.kind;
  return [
    ...(b.above != null
      ? [
          {
            kind: "line" as const,
            x1: xl,
            y1: b.above * STRIP_ROW,
            x2: xs,
            y2: top,
            versions,
            mark,
          },
        ]
      : []),
    { kind: "line", x1: xs, y1: top, x2: xs, y2: bottom, versions, mark },
    ...(b.below != null
      ? [
          {
            kind: "line" as const,
            x1: xs,
            y1: bottom,
            x2: xl,
            y2: b.below * STRIP_ROW,
            versions,
            mark,
          },
        ]
      : []),
  ];
}

/**
 * Mark the stretches of the line no run used as stubs: each straight piece crossing one is cut
 * there, and the middle carries the stub mark instead of being drawn twice.
 * @param segs - The line, merged.
 * @param stubs - The stretches.
 * @returns The line with the stubs cut in.
 */
function cutStubs(segs: StripSegment[], stubs: readonly StripSpan[]): StripSegment[] {
  let out = segs;
  for (const s of stubs) {
    const x = s.lane * STRIP_LANE;
    const top = s.top * STRIP_ROW;
    const bottom = s.bottom * STRIP_ROW;
    out = out.flatMap((g): StripSegment[] => {
      if (g.kind !== "line" || g.mark || g.x1 !== x || g.x2 !== x) return [g];
      const lo = Math.max(g.y1, top);
      const hi = Math.min(g.y2, bottom);
      if (hi <= lo) return [g];
      return [
        ...(g.y1 < lo ? [{ ...g, y2: lo }] : []),
        { ...g, y1: lo, y2: hi, mark: "stub" },
        ...(hi < g.y2 ? [{ ...g, y1: hi }] : []),
      ];
    });
  }
  return out;
}

/**
 * The strip's line as segments in its own frame (x = lane * {@link STRIP_LANE}, y = row *
 * {@link STRIP_ROW}), every stretch of line exactly once, each knowing the versions along it. With
 * the day's closures and detours, the stretches no run used are cut in as stubs, and the strands
 * round them and the announced stretches are added, merged the same way among themselves.
 * @param strip - The strip.
 * @param overlay - The day's closures and detours, or null for the line alone.
 * @returns The segments, top first.
 */
export function stripSegments(
  strip: Pick<RouteStrip, "rows" | "edges" | "versions">,
  overlay: StripOverlay | null = null,
): StripSegment[] {
  const rank = new Map(strip.versions.map((v, i) => [v.key, i]));
  const line = unionSegments(
    strip.edges.flatMap((e) => edgeSegments(e, strip.rows)),
    rank,
  );
  if (!overlay) return line;
  const marks = unionSegments(
    [
      ...overlay.bypasses.flatMap((b) => bypassSegments(b, versionsAlong(strip, bypassSpan(b)))),
      ...overlay.announced.map((s): StripSegment => ({
        kind: "line",
        x1: s.lane * STRIP_LANE,
        y1: s.top * STRIP_ROW,
        x2: s.lane * STRIP_LANE,
        y2: s.bottom * STRIP_ROW,
        versions: versionsAlong(strip, s),
        mark: "announced",
      })),
    ],
    rank,
  );
  return [...cutStubs(line, overlay.stubs), ...marks].sort(
    (a, b) => a.y1 - b.y1 || a.x1 - b.x1 || a.y2 - b.y2 || a.x2 - b.x2,
  );
}

/**
 * The lowest point a segment reaches.
 * @param s - The segment.
 * @returns Its greatest y.
 */
function segBottom(s: StripSegment): number {
  return s.kind === "arc" ? s.y1 + (s.arc?.r ?? 0) : Math.max(s.y1, s.y2);
}

/**
 * The furthest-out lane any line reaches within half a row of each row's ring, so a name can
 * start clear of it: a loop's way back beside the stops round the loop, a track beside the trunk.
 * @param rows - The rows, lanes set.
 * @param segs - The strip's segments.
 * @returns Each row's reach.
 */
function rowReach(rows: readonly StripRow[], segs: readonly StripSegment[]): number[] {
  return rows.map((row, i) => {
    const lo = i * STRIP_ROW - STRIP_ROW / 2;
    const hi = i * STRIP_ROW + STRIP_ROW / 2;
    let x = row.lane * STRIP_LANE;
    for (const s of segs) {
      if (Math.min(s.y1, s.y2) > hi || segBottom(s) < lo) continue;
      if (s.kind === "arc") {
        x = Math.max(x, s.x1, s.x2);
        continue;
      }
      const top = Math.max(lo, s.y1);
      const bottom = Math.min(hi, s.y2);
      /**
       * The segment's x at a height.
       * @param y - The height.
       * @returns The x.
       */
      const xAt = (y: number): number =>
        s.y2 === s.y1 ? Math.max(s.x1, s.x2) : s.x1 + ((y - s.y1) * (s.x2 - s.x1)) / (s.y2 - s.y1);
      x = Math.max(x, xAt(top), xAt(bottom));
    }
    return Math.floor(x / STRIP_LANE + 1e-9);
  });
}

/**
 * An empty strip, for a route with no readable pattern.
 * @returns The strip.
 */
function emptyStrip(): RouteStrip {
  return {
    rows: [],
    versions: [],
    edges: [],
    trunk: null,
    down: [],
    up: [],
    downTo: null,
    upTo: null,
    downWay: null,
    upWay: null,
    lanes: 0,
  };
}

/**
 * Where the given versions' runs on one side end, read in their own direction of travel.
 * @param drafts - The versions.
 * @param side - The side.
 * @param input - Stop names.
 * @returns The shared name, or null when they end in different places or have no run that way.
 */
function endOf(drafts: readonly Draft[], side: StripSide, input: StripInput): string | null {
  const ends = new Map<string, string>();
  for (const d of drafts) {
    for (const s of d.seqs) {
      if (s.side !== side) continue;
      const id = s.variant.stopIds.at(-1)!;
      const name = input.names.get(id) ?? id;
      ends.set(normName(name), name);
    }
  }
  return ends.size === 1 ? [...ends.values()][0]! : null;
}

/**
 * Which way round the given versions' runs on one side go, read from their headsigns: "Inner Link
 * Anticlockwise", "Newmarket Anti Clockwise To Pukekohe". Only a circuit run both ways needs it,
 * since both its columns end at the same stop and "To" can't tell them apart.
 * @param drafts - The versions.
 * @param side - The side.
 * @returns "Clockwise" or "Anticlockwise" when every run that way says the same, else null.
 */
function wayOf(drafts: readonly Draft[], side: StripSide): string | null {
  const ways = new Set<string | null>();
  for (const d of drafts) {
    for (const s of d.seqs) {
      if (s.side !== side) continue;
      const sign = s.variant.headsign ?? "";
      ways.add(
        /\banti[\s-]?clockwise\b/i.test(sign)
          ? "Anticlockwise"
          : /\bclockwise\b/i.test(sign)
            ? "Clockwise"
            : null,
      );
    }
  }
  return ways.size === 1 ? [...ways][0]! : null;
}

/**
 * Lay a route out as one strip.
 * - **Rows.** The directions merge by position (rule 11): a stop's two ids either side of the road
 *   are one row, and stops paired across the road under different names stay two one-way rows.
 * - **Trunk.** The chip-worthy version reaching the most stops, counted once per direction, so a
 *   stretch served both ways outweighs a one-way loop, with ties to the most runs. On 65 that puts
 *   Coyle Park on the straight line, with Selwyn Village and Walker Park on a track joining it at
 *   Wakatipu Street (rule 14).
 * - **Tracks.** Stops only other versions reach go on tracks beside the trunk (rules 13-16, 18).
 * - **Loops and circuits.** A run ending in a loop gets its way back drawn as a lasso (rule 20); a
 *   run starting and ending at one stop draws as a line whose last row repeats the first.
 * - **Minor versions.** Under {@link MINOR_SHARE} of the runs: no chip and no terminus mark, but a
 *   track when they reach stops nothing else serves.
 * @param input - The route view's directions, names and positions.
 * @returns The strip, as plain JSON.
 */
export function buildStrip(input: StripInput): RouteStrip {
  const dirIds = Object.keys(input.directions)
    .map(Number)
    .filter((d) => (input.directions[d]?.variants.length ?? 0) > 0)
    .sort((a, b) => a - b);
  if (dirIds.length === 0) return emptyStrip();
  const variants = dirIds.flatMap((d) =>
    [...(input.directions[d]?.variants ?? [])].sort((a, b) => b.tripCount - a.tripCount),
  );
  const { nodeOf, nodes } = buildNodes(variants, input);
  const { seqs, sideOf } = readSeqs(dirIds, input, nodeOf, nodes);
  if (seqs.length === 0) return emptyStrip();
  const drafts = groupVersions(seqs, input);

  // Trunk: the chip-worthy version with the most stops per direction, then the most runs.
  /**
   * Stops a version reaches, counted once per direction.
   * @param d - The version.
   * @returns The count.
   */
  const calls = (d: Draft): number =>
    (["down", "up"] as const).reduce(
      (n, side) => n + new Set(d.seqs.filter((s) => s.side === side).flatMap((s) => s.nodes)).size,
      0,
    );
  const pool = drafts.some((d) => !d.minor) ? drafts.filter((d) => !d.minor) : drafts;
  const trunk = maxBy(pool, (d) => calls(d) * 1e7 + d.trips)!;
  const trunkSeqs = (["down", "up"] as const)
    .map((side) =>
      maxBy(
        trunk.seqs.filter((s) => s.side === side),
        (s) => s.variant.tripCount,
      ),
    )
    .filter((s): s is Seq => s !== undefined);

  // Rows: the trunk's two runs merged, then every other run's own stops, busiest first.
  const units = drafts
    .map((d) => d.seqs.filter((s) => !trunkSeqs.includes(s)))
    .filter((u) => u.length > 0)
    .sort(
      (a, b) =>
        b.reduce((n, s) => n + s.variant.tripCount, 0) -
        a.reduce((n, s) => n + s.variant.tripCount, 0),
    );
  const trunkOrder = mergeOrder(trunkSeqs.map((s) => s.nodes));
  const { order, runs } = placeRows(trunkOrder, units);
  const rowOf = new Map(order.map((k, i) => [k, i]));
  const { laneOf, claim } = assignLanes(trunkOrder, runs, rowOf);

  // Loops: each way back takes a lane to the right of the loop's stops, over the rows it spans.
  const loopLane = new Map<string, number>();
  /**
   * A loop's identity: its anchor and the set of stops round it, whichever way it is run.
   * @param loop - The loop.
   * @returns The key.
   */
  const loopId = (loop: NonNullable<Seq["loop"]>): string =>
    `${loop.anchor}>${[...loop.stops].sort().join(",")}`;
  for (const s of seqs) {
    if (!s.loop || s.loop.stops.length === 0) continue;
    const id = loopId(s.loop);
    if (loopLane.has(id)) continue;
    const anchor = rowOf.get(s.loop.anchor)!;
    const last = Math.max(...s.loop.stops.map((k) => rowOf.get(k)!));
    const inner = Math.max(...[s.loop.anchor, ...s.loop.stops].map((k) => laneOf.get(k) ?? 0));
    loopLane.set(id, claim(inner + 1, 2 * anchor + 1, 2 * last + 1));
  }

  // Versions in the order the chips show them: top of the strip first, minor ones last.
  /**
   * The highest row a version reaches.
   * @param d - The version.
   * @returns The row.
   */
  const minRow = (d: Draft): number =>
    Math.min(...d.seqs.flatMap((s) => s.nodes.map((k) => rowOf.get(k)!)));
  const listed = [
    ...drafts.filter((d) => !d.minor).sort((a, b) => minRow(a) - minRow(b) || b.trips - a.trips),
    ...drafts.filter((d) => d.minor).sort((a, b) => b.trips - a.trips || minRow(a) - minRow(b)),
  ];
  const rank = new Map(listed.map((d, i) => [d.key, i]));

  // Termini: where a chip-worthy run starts or ends, and the far end of every track.
  const termini = new Set<string>();
  for (const d of drafts.filter((x) => !x.minor)) {
    for (const s of d.seqs) for (const k of s.ends) termini.add(k);
  }
  for (const r of runs) {
    if (r.kind === "head" || r.kind === "loose") termini.add(r.keys[0]!);
    if (r.kind === "tail" || r.kind === "loose") termini.add(r.keys.at(-1)!);
  }
  const served = { down: new Set<string>(), up: new Set<string>() };
  for (const s of seqs) for (const k of s.nodes) served[s.side].add(k);

  const rows: StripRow[] = order.map((key) => {
    const node = nodes.get(key)!;
    return {
      key,
      stopIds: [...node.stopIds],
      name: node.name,
      lane: laneOf.get(key) ?? 0,
      down: served.down.has(key),
      up: served.up.has(key),
      terminus: termini.has(key),
      repeats: node.repeats,
      reach: 0,
    };
  });

  // Edges: each run's consecutive stops, and each loop's way back, merged across versions.
  const edgeMap = new Map<string, { e: StripEdge; vs: Set<string> }>();
  /**
   * Add a stretch for a version.
   * @param a - One row.
   * @param b - The other.
   * @param lane - The loop's lane for a way back, else null.
   * @param version - The version's key.
   */
  const addEdge = (a: number, b: number, lane: number | null, version: string): void => {
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    const id = `${from}>${to}>${lane ?? ""}`;
    let hit = edgeMap.get(id);
    if (!hit)
      edgeMap.set(id, (hit = { e: { from, to, versions: [], loopLane: lane }, vs: new Set() }));
    hit.vs.add(version);
  };
  for (const d of drafts) {
    for (const s of d.seqs) {
      for (let i = 1; i < s.nodes.length; i++) {
        addEdge(rowOf.get(s.nodes[i - 1]!)!, rowOf.get(s.nodes[i]!)!, null, d.key);
      }
      if (s.loop && s.loop.stops.length > 0) {
        const lane = loopLane.get(loopId(s.loop))!;
        const last = Math.max(...s.loop.stops.map((k) => rowOf.get(k)!));
        addEdge(rowOf.get(s.loop.anchor)!, last, lane, d.key);
      }
    }
  }
  const edges = [...edgeMap.values()]
    .map(({ e, vs }) => ({ ...e, versions: [...vs].sort((a, b) => rank.get(a)! - rank.get(b)!) }))
    .sort((a, b) => a.from - b.from || a.to - b.to || (a.loopLane ?? -1) - (b.loopLane ?? -1));

  const versions: StripVersion[] = listed.map((d) => {
    /**
     * The rows a version stops at, reading one way.
     * @param side - The way.
     * @returns Row indexes, top first.
     */
    const rowsOn = (side: StripSide): number[] =>
      [
        ...new Set(
          d.seqs.filter((s) => s.side === side).flatMap((s) => s.nodes.map((k) => rowOf.get(k)!)),
        ),
      ].sort((a, b) => a - b);
    const downRows = rowsOn("down");
    const upRows = rowsOn("up");
    const stops = new Set([...downRows, ...upRows]);
    const passes = new Set<number>();
    for (const e of edges) {
      if (!e.versions.includes(d.key)) continue;
      const la = rows[e.from]!.lane;
      const lb = rows[e.to]!.lane;
      for (let r = e.from + 1; r < e.to; r++) {
        if (stops.has(r)) continue;
        const lane = rows[r]!.lane;
        const y = r * STRIP_ROW;
        const onLine =
          e.loopLane !== null
            ? lane === e.loopLane
            : la === lb
              ? lane === la
              : la > lb
                ? lane === la && y <= e.to * STRIP_ROW - (la - lb) * STRIP_LANE
                : lane === lb && y >= e.from * STRIP_ROW + (lb - la) * STRIP_LANE;
        if (onLine) passes.add(r);
      }
    }
    return {
      key: d.key,
      from: d.from,
      to: d.to,
      downTo: endOf([d], "down", input),
      upTo: endOf([d], "up", input),
      downWay: wayOf([d], "down"),
      upWay: wayOf([d], "up"),
      tripCount: d.trips,
      minor: d.minor,
      variants: d.seqs.map((s) => ({
        directionId: s.variant.directionId,
        headsign: s.variant.headsign,
        shapeId: s.variant.shapeId,
        ...(s.variant.shapeIds ? { shapeIds: [...s.variant.shapeIds] } : {}),
        tripCount: s.variant.tripCount,
      })),
      downRows,
      upRows,
      passes: [...passes].sort((a, b) => a - b),
    };
  });

  const reach = rowReach(rows, stripSegments({ rows, edges, versions }));
  rows.forEach((r, i) => (r.reach = reach[i]!));
  const chipped = drafts.filter((d) => !d.minor);

  return {
    rows,
    versions,
    edges,
    trunk: trunk.key,
    down: dirIds.filter((d) => sideOf.get(d) === "down"),
    up: dirIds.filter((d) => sideOf.get(d) === "up"),
    downTo: endOf(chipped, "down", input),
    upTo: endOf(chipped, "up", input),
    downWay: wayOf(chipped, "down"),
    upWay: wayOf(chipped, "up"),
    lanes: Math.max(0, ...rows.map((r) => r.lane), ...edges.map((e) => e.loopLane ?? 0)) + 1,
  };
}

/**
 * Where to break a strip into columns (rule 5). A break is allowed only between rows where the
 * straight line is all that crosses: never inside a track, a join, a loop, or a span the caller
 * rules out (a closed run's bypass). Each break goes at the allowed boundary nearest an even
 * share of the rows, the later one on a tie, so the first column is the longer.
 * @param strip - The strip.
 * @param cols - How many columns.
 * @param noBreak - Row spans `[lo, hi]` no break may fall inside.
 * @returns Break rows: each is the first row of a new column. Fewer than `cols - 1` when there is
 *   no room.
 */
export function pickBreaks(
  strip: RouteStrip,
  cols: number,
  noBreak: ReadonlyArray<readonly [number, number]> = [],
): number[] {
  const n = strip.rows.length;
  if (cols < 2 || n < 2) return [];
  const segs = stripSegments(strip);
  const allowed: number[] = [];
  for (let b = 1; b < n; b++) {
    if (noBreak.some(([lo, hi]) => lo < b && b <= hi)) continue;
    const lo = (b - 1) * STRIP_ROW;
    const hi = b * STRIP_ROW;
    const clear = segs.every(
      (s) =>
        segBottom(s) <= lo ||
        Math.min(s.y1, s.y2) >= hi ||
        (s.kind === "line" && s.x1 === 0 && s.x2 === 0),
    );
    if (clear) allowed.push(b);
  }
  const breaks: number[] = [];
  for (let c = 1; c < cols; c++) {
    const target = Math.ceil((n * c) / cols);
    const prev = breaks.at(-1) ?? 0;
    const best = maxBy(
      allowed.filter((b) => b > prev),
      (b) => -Math.abs(b - target) * 2 + (b >= target ? 1 : 0),
    );
    if (best !== undefined) breaks.push(best);
  }
  return breaks;
}

/**
 * A number as SVG path text: at most two decimals.
 * @param n - The number.
 * @returns The text.
 */
function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Join segments into drawable paths: each path runs on through every point where exactly two
 * segments meet and both carry the same versions, so a track and its 45 degree join are one path.
 * @param segs - One column's segments, in its frame.
 * @returns The paths, top first.
 */
function chainPieces(segs: readonly StripSegment[]): StripPiece[] {
  /**
   * A point as a key, rounded as the path prints it, so ends that meet on paper match.
   * @param x - The x.
   * @param y - The y.
   * @returns The key.
   */
  const pointKey = (x: number, y: number): string => `${num(x)},${num(y)}`;
  /**
   * A segment's start (0) or end (1).
   * @param i - The segment.
   * @param end - Which end.
   * @returns `[x, y]`.
   */
  const at = (i: number, end: 0 | 1): [number, number] => {
    const s = segs[i]!;
    return end === 0 ? [s.x1, s.y1] : [s.x2, s.y2];
  };
  const ends = new Map<string, Array<{ seg: number; end: 0 | 1 }>>();
  segs.forEach((_, i) => {
    for (const end of [0, 1] as const) {
      const k = pointKey(...at(i, end));
      ends.set(k, [...(ends.get(k) ?? []), { seg: i, end }]);
    }
  });
  /**
   * A segment's versions as one comparable string.
   * @param i - The segment.
   * @returns The key.
   */
  const setOf = (i: number): string => `${segs[i]!.mark ?? ""}:${segs[i]!.versions.join("|")}`;
  /**
   * The segment a path runs on into from one end of another, if it can.
   * @param i - The segment.
   * @param end - The end it leaves by.
   * @returns The next segment and the end it is entered by, or null.
   */
  const partner = (i: number, end: 0 | 1): { seg: number; end: 0 | 1 } | null => {
    const list = ends.get(pointKey(...at(i, end))) ?? [];
    if (list.length !== 2) return null;
    const o = list[0]!.seg === i && list[0]!.end === end ? list[1]! : list[0]!;
    return setOf(o.seg) === setOf(i) ? o : null;
  };

  const used = new Array<boolean>(segs.length).fill(false);
  const pieces: StripPiece[] = [];
  /**
   * Draw a path from one end of a segment, running on while it can.
   * @param start - The first segment.
   * @param inEnd - The end the path starts at.
   */
  const walk = (start: number, inEnd: 0 | 1): void => {
    const from = at(start, inEnd);
    let d = `M ${num(from[0])} ${num(from[1])}`;
    let s = start;
    let enter = inEnd;
    let to = from;
    for (;;) {
      used[s] = true;
      const seg = segs[s]!;
      const out: 0 | 1 = enter === 0 ? 1 : 0;
      to = at(s, out);
      if (seg.kind === "arc" && seg.arc) {
        const sweep = enter === 0 ? seg.arc.sweep : 1 - seg.arc.sweep;
        d += ` A ${num(seg.arc.r)} ${num(seg.arc.r)} 0 0 ${sweep} ${num(to[0])} ${num(to[1])}`;
      } else {
        d += ` L ${num(to[0])} ${num(to[1])}`;
      }
      const next = partner(s, out);
      if (!next || used[next.seg]) break;
      s = next.seg;
      enter = next.end;
    }
    const mark = segs[start]!.mark;
    pieces.push({ d, versions: [...segs[start]!.versions], from, to, ...(mark ? { mark } : {}) });
  };

  const starts = segs
    .flatMap((_, i) =>
      ([0, 1] as const).filter((end) => !partner(i, end)).map((end) => ({ i, end })),
    )
    .sort((a, b) => {
      const [ax, ay] = at(a.i, a.end);
      const [bx, by] = at(b.i, b.end);
      return ay - by || ax - bx;
    });
  for (const { i, end } of starts) if (!used[i]) walk(i, end);
  // Whatever is left closes on itself.
  segs.forEach((_, i) => {
    if (!used[i]) walk(i, 0);
  });
  return pieces;
}

/**
 * Lay a strip out in columns, each in its own frame: its rows' ring centres, and its line as SVG
 * paths with the versions each carries. A stretch of straight line crossing a break becomes a tail
 * at the foot of one column and a tail at the head of the next. A strand round a closure never
 * crosses a break, since the breaks are picked clear of them.
 * @param strip - The strip.
 * @param breaks - The first row of each column after the first, as {@link pickBreaks} gives.
 * @param dims - Where the drawing sits in each column.
 * @param overlay - The day's closures and detours, or null for the line alone.
 * @returns The columns.
 */
export function layoutStrip(
  strip: RouteStrip,
  breaks: readonly number[],
  dims: StripDims,
  overlay: StripOverlay | null = null,
): StripColumn[] {
  const n = strip.rows.length;
  if (n === 0) return [];
  const bounds = [
    0,
    ...[...new Set(breaks)].filter((b) => b > 0 && b < n).sort((a, b) => a - b),
    n,
  ];
  const segs = stripSegments(strip, overlay);
  /**
   * A row's ring height in the strip's frame.
   * @param r - The row.
   * @returns The y.
   */
  const y = (r: number): number => r * STRIP_ROW;
  const columns: StripColumn[] = [];
  for (let c = 0; c + 1 < bounds.length; c++) {
    const r0 = bounds[c]!;
    const r1 = bounds[c + 1]!;
    const bandTop = c === 0 ? -Infinity : (y(r0 - 1) + y(r0)) / 2;
    const bandBot = r1 === n ? Infinity : (y(r1 - 1) + y(r1)) / 2;
    const dx = dims.left;
    const dy = dims.top - y(r0);
    const local: StripSegment[] = [];
    for (const s of segs) {
      const vertical = s.kind === "line" && s.x1 === s.x2;
      if (vertical) {
        let lo = Math.max(s.y1, bandTop);
        let hi = Math.min(s.y2, bandBot);
        if (lo >= hi) continue;
        if (s.y1 < bandTop) lo = Math.max(s.y1, y(r0) - dims.tail);
        if (s.y2 > bandBot) hi = Math.min(s.y2, y(r1 - 1) + dims.tail);
        local.push({ ...s, x1: s.x1 + dx, x2: s.x2 + dx, y1: lo + dy, y2: hi + dy });
        continue;
      }
      const mid = s.kind === "arc" ? s.y1 : (s.y1 + s.y2) / 2;
      if (mid < bandTop || mid >= bandBot) continue;
      local.push({ ...s, x1: s.x1 + dx, x2: s.x2 + dx, y1: s.y1 + dy, y2: s.y2 + dy });
    }
    const rows = strip.rows.slice(r0, r1).map((row, i) => ({
      index: r0 + i,
      x: dims.left + row.lane * STRIP_LANE,
      y: dims.top + i * STRIP_ROW,
    }));
    columns.push({
      rows,
      pieces: chainPieces(local),
      bottom: Math.max(...rows.map((r) => r.y), ...local.map(segBottom)),
    });
  }
  return columns;
}

/**
 * The runs of rows closed one way, for bending that direction's strand round them (rules 21-24).
 * A run takes in the rows either side on the same lane that the direction never serves, so the
 * strand doesn't dead-end at a dashed half (Mount Albert Shops beside Benfield Avenue, towards
 * Newmarket), and closed rows next to each other share one run.
 * @param rows - The strip's rows.
 * @param side - The direction.
 * @param closed - Keys of the rows closed that way.
 * @returns `[first, last]` row spans, top first.
 */
export function closedRuns(
  rows: readonly StripRow[],
  side: StripSide,
  closed: ReadonlySet<string>,
): Array<[number, number]> {
  /**
   * Whether a row is one the direction never serves, on the given lane, and not itself closed.
   * @param i - The row.
   * @param lane - The lane.
   * @returns True to stretch a run over it.
   */
  const unserved = (i: number, lane: number): boolean => {
    const r = rows[i];
    return !!r && !r[side] && !closed.has(r.key) && r.lane === lane;
  };
  const runs: Array<[number, number]> = [];
  rows.forEach((r, i) => {
    if (!closed.has(r.key)) return;
    const last = runs.at(-1);
    if (last && last[1] >= i - 1 && rows[last[1]]?.lane === r.lane) last[1] = Math.max(last[1], i);
    else {
      let lo = i;
      while (unserved(lo - 1, r.lane)) lo--;
      runs.push([lo, i]);
    }
    const run = runs.at(-1)!;
    while (unserved(run[1] + 1, r.lane)) run[1]++;
  });
  return runs;
}

/**
 * A row's figure for one column: its stop ids and the column's directions combined, weighted by
 * arrivals, so a stop with an id on each side of the road reads as one.
 * @param figures - Figures by stop, then direction.
 * @param row - The row.
 * @param dirIds - The column's direction ids.
 * @returns The figure, or null when no run was recorded there.
 */
export function rowFigure(
  figures: StopFigures,
  row: Pick<StripRow, "stopIds">,
  dirIds: readonly number[],
): StopFigure | null {
  let events = 0;
  let dev = 0;
  let onTime = 0;
  for (const id of row.stopIds) {
    for (const d of dirIds) {
      const f = figures[id]?.[d];
      if (!f) continue;
      events += f.events;
      dev += f.avg_delay_sec * f.events;
      onTime += f.on_time_pct * f.events;
    }
  }
  if (events === 0) return null;
  return {
    events,
    avg_delay_sec: Math.round((dev / events) * 10) / 10,
    on_time_pct: Math.round((onTime / events) * 10) / 10,
  };
}
