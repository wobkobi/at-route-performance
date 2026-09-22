// tests/lib/strip-marks.test.ts
import {
  buildStrip,
  BYPASS_OFF,
  STRIP_LANE,
  STRIP_ROW,
  stripSegments,
  type RouteStrip,
  type StripSegment,
} from "@/lib/route-strip";
import { stripMarks, type DayClosure, type StripMarks } from "@/lib/strip-marks";
import type { RouteVariant } from "@/types/api";
import { describe, expect, it } from "vitest";
import rawViews from "./fixtures/route-views.json";

/** One route as the fixture dump holds it. */
interface FixtureView {
  directions: Record<string, { variants: RouteVariant[] }>;
  names: Record<string, string>;
  coords: Record<string, [number, number]>;
}

const views = rawViews as unknown as Record<string, FixtureView>;

/** 23 Sep 2026's service day, 4am to 4am NZ. */
const DAY = { start: Date.parse("2026-09-22T16:00:00Z"), end: Date.parse("2026-09-23T16:00:00Z") };
const HOUR = 3_600_000;

/**
 * A fixture route's directions, keyed by number.
 * @param slug - The route.
 * @returns The directions.
 */
function directionsOf(slug: string): Record<number, { variants: RouteVariant[] }> {
  return Object.fromEntries(
    Object.entries(views[slug]!.directions).map(([d, x]) => [Number(d), x]),
  );
}

/**
 * Build a fixture route's strip.
 * @param slug - The route.
 * @returns The strip.
 */
function strip(slug: string): RouteStrip {
  const v = views[slug]!;
  return buildStrip({
    directions: directionsOf(slug),
    names: new Map(Object.entries(v.names)),
    coords: new Map(Object.entries(v.coords)),
  });
}

/**
 * The row with a name.
 * @param s - The strip.
 * @param name - The stop's name.
 * @returns The row's index; the test fails when there is none.
 */
function rowOf(s: RouteStrip, name: string): number {
  const i = s.rows.findIndex((r) => r.name === name);
  expect(i, name).toBeGreaterThanOrEqual(0);
  return i;
}

/**
 * The stop id a direction uses at a named stop: a bus stop has one each way.
 * @param slug - The route.
 * @param s - Its strip.
 * @param name - The stop's name.
 * @param dir - The GTFS direction.
 * @returns The id; the test fails when there is none.
 */
function idOn(slug: string, s: RouteStrip, name: string, dir: number): string {
  const used = new Set(directionsOf(slug)[dir]!.variants.flatMap((v) => v.stopIds));
  const id = s.rows[rowOf(s, name)]!.stopIds.find((x) => used.has(x));
  expect(id, `${name} ${dir}`).toBeDefined();
  return id!;
}

/**
 * A closure, closed by an alert and held all day unless told otherwise.
 * @param over - The fields to set.
 * @returns The closure.
 */
function closure(over: Partial<DayClosure>): DayClosure {
  return {
    kind: "closed",
    source: "alert",
    directionId: null,
    stopIds: [],
    fromStopId: null,
    toStopId: null,
    alert: null,
    runs: 0,
    confirmed: false,
    disputed: false,
    from: DAY.start - HOUR,
    to: null,
    ...over,
  };
}

/**
 * Place closures on a fixture route.
 * @param slug - The route.
 * @param s - Its strip.
 * @param closures - The closures.
 * @returns The marks.
 */
function marks(slug: string, s: RouteStrip, closures: DayClosure[]): StripMarks {
  return stripMarks({
    strip: s,
    directions: directionsOf(slug),
    closures,
    rawToCanon: new Map(),
    directionIdAliases: new Map(),
    day: DAY,
  });
}

describe("stripMarks: closed stops on OUT (Benfield Avenue, rules 21-23)", () => {
  const s = strip("OUT");
  const benfield = rowOf(s, "Benfield Avenue");
  const shops = rowOf(s, "Mount Albert Shops");
  const lloyd = rowOf(s, "Lloyd Avenue");
  const down = idOn("OUT", s, "Benfield Avenue", 0);
  const up = idOn("OUT", s, "Benfield Avenue", 1);

  it("closes the side whose runs use the stop id the alert names", () => {
    const m = marks("OUT", s, [closure({ stopIds: [down], alert: "Benfield Ave stop closed" })]);
    expect(m.rows[benfield]).toEqual({ down: { kind: "closed", allDay: true }, up: null });
    expect(m.alertRows).toEqual([benfield]);
    expect(m.notes).toEqual([
      {
        rows: [benfield, benfield],
        side: "down",
        kind: "closed",
        source: "alert",
        from: null,
        to: null,
        alert: "Benfield Ave stop closed",
        runs: 0,
      },
    ]);
  });

  it("bends that side's strand round the neighbour it never serves, and leaves the line open", () => {
    const m = marks("OUT", s, [closure({ stopIds: [down] })]);
    expect(m.bypasses).toEqual([
      {
        side: "down",
        kind: "closed",
        lane: 0,
        above: lloyd,
        below: benfield + 1,
        lo: shops,
        hi: benfield,
      },
    ]);
    expect(m.stubs).toEqual([]);
  });

  it("closed both ways, bends both strands and stubs the line neither uses", () => {
    const m = marks("OUT", s, [closure({ stopIds: [down, up] })]);
    expect(m.rows[benfield]).toEqual({
      down: { kind: "closed", allDay: true },
      up: { kind: "closed", allDay: true },
    });
    expect(m.bypasses.map((b) => [b.side, b.above, b.below])).toEqual([
      ["down", lloyd, benfield + 1],
      ["up", shops, benfield + 1],
    ]);
    expect(m.stubs).toEqual([{ lane: 0, top: shops, bottom: benfield + 1 }]);
    expect(m.notes.map((n) => n.side)).toEqual(["both"]);
  });

  it("keeps a part-day closure off the strands, with its times in the note (rule 25)", () => {
    const from = DAY.start + 17 * HOUR;
    const m = marks("OUT", s, [closure({ stopIds: [down], from })]);
    expect(m.rows[benfield]!.down).toEqual({ kind: "closed", allDay: false });
    expect(m.bypasses).toEqual([]);
    expect(m.notes[0]).toMatchObject({ from, to: null });
  });

  it("counts a skip only once enough runs showed it, and only the way they went", () => {
    const skip = closure({ source: "skipped", directionId: 1, stopIds: [up], runs: 1 });
    expect(marks("OUT", s, [skip]).rows[benfield]).toEqual({ down: null, up: null });
    const trend = marks("OUT", s, [{ ...skip, runs: 3, confirmed: true }]);
    expect(trend.rows[benfield]).toEqual({ down: null, up: { kind: "closed", allDay: true } });
    expect(trend.alertRows).toEqual([]);
    expect(trend.notes[0]).toMatchObject({ side: "up", source: "skipped" });
  });
});

describe("stripMarks: detours on OUT (rules 27-28)", () => {
  const s = strip("OUT");
  const ferndale = rowOf(s, "Ferndale House");
  const gladstone = rowOf(s, "Gladstone Primary");
  const seen = closure({
    kind: "detour",
    source: "seen",
    directionId: 0,
    fromStopId: idOn("OUT", s, "Ferndale House", 0),
    toStopId: idOn("OUT", s, "Gladstone Primary", 0),
    runs: 4,
    confirmed: true,
  });

  it("marks the stops between the two served, the way the runs went, with a strand", () => {
    const m = marks("OUT", s, [seen]);
    const between = m.rows.slice(ferndale + 1, gladstone).map((r) => r.down?.kind ?? null);
    // Mount Albert Shops is never served down the page, so it takes no mark.
    expect(between).toEqual(["detour", null, "detour"]);
    expect(m.rows.every((r) => r.up === null)).toBe(true);
    expect(m.bypasses).toEqual([
      {
        side: "down",
        kind: "detour",
        lane: 0,
        above: ferndale,
        below: gladstone,
        lo: ferndale + 1,
        hi: gladstone - 1,
      },
    ]);
    expect(m.notes[0]).toMatchObject({ rows: [ferndale, gladstone], side: "down", kind: "detour" });
  });

  it("draws one a run or two took as suspected, and never stubs the line for it", () => {
    const m = marks("OUT", s, [{ ...seen, runs: 1, confirmed: false }]);
    expect(m.bypasses.map((b) => b.kind)).toEqual(["suspect"]);
    expect(m.rows[ferndale + 1]!.down!.kind).toBe("suspect");
    expect(m.stubs).toEqual([]);
  });

  it("leaves off a detour whose stops came in the wrong order for its way", () => {
    const m = marks("OUT", s, [{ ...seen, fromStopId: seen.toStopId, toStopId: seen.fromStopId }]);
    expect(m.bypasses).toEqual([]);
    expect(m.notes).toEqual([]);
  });

  it("lays an announced detour along the line over the stops it names, both ways", () => {
    const named = ["Alberta Street", "Wakatipu Street"].flatMap((n) => [
      idOn("OUT", s, n, 0),
      idOn("OUT", s, n, 1),
    ]);
    const m = marks("OUT", s, [closure({ kind: "detour", stopIds: named })]);
    const alberta = rowOf(s, "Alberta Street");
    expect(m.rows[alberta]).toEqual({
      down: { kind: "announced", allDay: true },
      up: { kind: "announced", allDay: true },
    });
    expect(m.announced).toEqual([{ lane: 0, top: alberta - 0.5, bottom: alberta + 1.5 }]);
    expect(m.bypasses).toEqual([]);
    expect(m.notes[0]).toMatchObject({ side: "both", kind: "announced" });
  });

  it("only notes an announced detour the runs drove straight through", () => {
    const named = [idOn("OUT", s, "Alberta Street", 0)];
    const m = marks("OUT", s, [closure({ kind: "detour", stopIds: named, disputed: true })]);
    expect(m.rows.every((r) => r.down === null && r.up === null)).toBe(true);
    expect(m.announced).toEqual([]);
    expect(m.notes.map((n) => n.kind)).toEqual(["disputed"]);
  });

  it("leaves an announced detour to the strand where the runs showed where they went", () => {
    const named = [idOn("OUT", s, "Benfield Avenue", 0)];
    const m = marks("OUT", s, [seen, closure({ kind: "detour", stopIds: named })]);
    expect(m.announced).toEqual([]);
    expect(m.rows[rowOf(s, "Benfield Avenue")]!.down!.kind).toBe("detour");
    expect(m.alertRows).toEqual([rowOf(s, "Benfield Avenue")]);
  });
});

describe("stripMarks: strands on 65's track, and on a one-way route", () => {
  it("keeps a strand on its own track, anchored at the rows either side on it", () => {
    const s = strip("65");
    const katoa = rowOf(s, "Katoa Street");
    const m = marks("65", s, [closure({ stopIds: [idOn("65", s, "Katoa Street", 0)] })]);
    // Down the page never serves the three stops after it, so the strand takes them in.
    expect(m.bypasses).toEqual([
      {
        side: "down",
        kind: "closed",
        lane: 1,
        above: rowOf(s, "Selwyn Village"),
        below: rowOf(s, "Walker Park"),
        lo: katoa,
        hi: rowOf(s, "Muripara Avenue"),
      },
    ]);
  });

  it("starts a strand beside the row where the one above is on another track", () => {
    const s = strip("65");
    const selwyn = rowOf(s, "Selwyn Village");
    const m = marks("65", s, [closure({ stopIds: [idOn("65", s, "Selwyn Village", 0)] })]);
    expect(m.bypasses[0]).toMatchObject({ lane: 1, above: null, lo: selwyn });
  });

  it("stubs the line under a one-way route's strand, since no run is left on it", () => {
    const s: RouteStrip = {
      rows: ["A", "B", "C"].map((name, i) => ({
        key: name,
        stopIds: [name],
        name,
        lane: 0,
        down: true,
        up: false,
        terminus: i !== 1,
        repeats: null,
        reach: 0,
      })),
      versions: [],
      edges: [
        { from: 0, to: 1, versions: [], loopLane: null },
        { from: 1, to: 2, versions: [], loopLane: null },
      ],
      trunk: null,
      down: [0],
      up: [],
      downTo: "C",
      upTo: null,
      downWay: null,
      upWay: null,
      lanes: 1,
    };
    const m = stripMarks({
      strip: s,
      directions: { 0: { variants: [] } },
      closures: [closure({ source: "skipped", directionId: 0, stopIds: ["B"], confirmed: true })],
      rawToCanon: new Map(),
      directionIdAliases: new Map(),
      day: DAY,
    });
    expect(m.stubs).toEqual([{ lane: 0, top: 0, bottom: 2 }]);
  });
});

describe("the strands' geometry", () => {
  const s = strip("OUT");
  const lloyd = rowOf(s, "Lloyd Avenue");
  const shops = rowOf(s, "Mount Albert Shops");
  const below = rowOf(s, "Benfield Avenue") + 1;
  const both = marks("OUT", s, [
    closure({
      stopIds: [idOn("OUT", s, "Benfield Avenue", 0), idOn("OUT", s, "Benfield Avenue", 1)],
    }),
  ]);
  const segs = stripSegments(s, both);

  /**
   * The segments carrying one mark.
   * @param mark - The mark.
   * @returns Them.
   */
  const marked = (mark: StripSegment["mark"]): StripSegment[] =>
    segs.filter((g) => g.mark === mark);

  it("steps each strand off and back on at the ring centres either side, 45 degrees out", () => {
    const strands = marked("closed");
    const ends = strands.flatMap((g) => [`${g.x1},${g.y1}`, `${g.x2},${g.y2}`]);
    for (const row of [lloyd, shops, below]) expect(ends).toContain(`0,${row * STRIP_ROW}`);
    expect(strands.filter((g) => g.x1 === g.x2).map((g) => g.x1)).toEqual([
      -BYPASS_OFF,
      BYPASS_OFF,
    ]);
    for (const g of strands.filter((x) => x.x1 !== x.x2)) {
      expect(Math.abs(g.x2 - g.x1)).toBe(g.y2 - g.y1);
    }
  });

  it("cuts the stub out of the line rather than drawing over it", () => {
    const [stub] = marked("stub");
    expect(stub).toMatchObject({ x1: 0, x2: 0, y1: shops * STRIP_ROW, y2: below * STRIP_ROW });
    const line = segs.filter((g) => g.mark === undefined && g.x1 === 0 && g.x2 === 0);
    for (const g of line) {
      expect(Math.min(g.y2, stub!.y2) - Math.max(g.y1, stub!.y1)).toBeLessThanOrEqual(0);
    }
    const covered = line
      .map((g) => g.y2 - g.y1)
      .concat(stub!.y2 - stub!.y1)
      .reduce((a, b) => a + b, 0);
    expect(covered).toBe((s.rows.length - 1) * STRIP_ROW);
  });

  it("puts the strands on each direction's own side of its lane", () => {
    const s65 = strip("65");
    const m = marks("65", s65, [closure({ stopIds: [idOn("65", s65, "Katoa Street", 0)] })]);
    const vertical = stripSegments(s65, m).filter((g) => g.mark === "closed" && g.x1 === g.x2);
    expect(vertical.map((g) => g.x1)).toEqual([STRIP_LANE - BYPASS_OFF]);
  });
});
