// tests/lib/strip-view.test.ts
import { buildStrip, type RouteStrip } from "@/lib/route-strip";
import type { StopSplit } from "@/lib/stop-split";
import { stripView } from "@/lib/strip-view";
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

/**
 * Build a fixture route's strip.
 * @param slug - The route.
 * @returns The strip.
 */
function strip(slug: string): RouteStrip {
  const v = views[slug]!;
  return buildStrip({
    directions: Object.fromEntries(Object.entries(v.directions).map(([d, x]) => [Number(d), x])),
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

describe("stripView: route 65, three versions into Glen Innes", () => {
  const s = strip("65");

  it("heads the columns with the shared end, and falls back where the versions end apart", () => {
    const v = stripView({ strip: s, split: null, version: null, mode: "BUS" });
    expect([v.downHeading, v.upHeading]).toEqual(["To Glen Innes Station", "To the start"]);
  });

  it("heads the columns with the picked version's own ends", () => {
    const coyle = s.versions.find((x) => x.from === "Coyle Park")!;
    const v = stripView({ strip: s, split: null, version: coyle.key, mode: "BUS" });
    expect([v.downHeading, v.upHeading]).toEqual(["To Glen Innes Station", "To Coyle Park"]);
  });

  it("marks every row the picked version doesn't reach as off, and keeps every row in place", () => {
    const coyle = s.versions.find((x) => x.from === "Coyle Park")!;
    const v = stripView({ strip: s, split: null, version: coyle.key, mode: "BUS" });
    expect(v.rows).toHaveLength(s.rows.length);
    const used = new Set([...coyle.downRows, ...coyle.upRows, ...coyle.passes]);
    const off = v.rows.flatMap((r, i) => (r.state === "off" ? [i] : []));
    expect(off.length).toBeGreaterThan(0);
    expect(off.every((i) => !used.has(i))).toBe(true);
    expect(v.rows[off[0]!]!.sentence).toMatch(/: not on this version\.$/);
    expect(v.present.off).toBe(true);
  });

  it("dashes the half of a stop served one way only", () => {
    const v = stripView({ strip: s, split: null, version: null, mode: "BUS" });
    const potters = v.rows[rowOf(s, "Potters Park")]!;
    expect(potters.down.tone).toBe("none");
    expect(potters.up).toEqual({ tone: "unserved", text: "-" });
    expect(potters.bothWays).toBe(false);
    expect(potters.sentence).toBe(
      "Potters Park: To Glen Innes Station, stops here; To the start, doesn't stop.",
    );
    expect(v.present.unserved).toBe(true);
    // No figures per stop (the week), so a stop with none recorded isn't flagged for the key.
    expect(v.present.none).toBe(false);
  });

  it("colours a half by its figure, and greys one with no arrivals recorded", () => {
    const i = rowOf(s, "Potters Park");
    const split: StopSplit = {
      all: { [s.rows[i]!.stopIds[0]!]: { 0: { events: 4, avg_delay_sec: 600, on_time_pct: 25 } } },
      byVersion: {},
    };
    const v = stripView({ strip: s, split, version: null, mode: "BUS" });
    const potters = v.rows[i]!;
    expect(potters.down.tone).toBe("late");
    expect(potters.down.text).toMatch(/late$/);
    expect(potters.sentence).toContain(`To Glen Innes Station, ${potters.down.text}`);
    const quiet = v.rows.find((r) => r.state === "on" && r.down.tone === "none")!;
    expect(quiet.sentence).toContain("no arrivals recorded");
    expect(v.present.none).toBe(true);
  });

  it("reads the picked version's figures alone", () => {
    const i = rowOf(s, "Potters Park");
    const id = s.rows[i]!.stopIds[0]!;
    const walker = s.versions.find((x) => x.from === "Walker Park")!;
    const split: StopSplit = {
      all: { [id]: { 0: { events: 4, avg_delay_sec: 600, on_time_pct: 25 } } },
      byVersion: {
        [walker.key]: { [id]: { 0: { events: 2, avg_delay_sec: -300, on_time_pct: 0 } } },
      },
    };
    const v = stripView({ strip: s, split, version: walker.key, mode: "BUS" });
    expect(v.rows[i]!.down.tone).toBe("early");
  });
});

describe("stripView: route 70, minor versions that skip stops", () => {
  const s = strip("70");

  it("marks the rows a picked version runs through without stopping as passed", () => {
    const skip = s.versions.find((x) => x.passes.length > 0)!;
    const v = stripView({ strip: s, split: null, version: skip.key, mode: "BUS" });
    for (const i of skip.passes) {
      expect(v.rows[i]!.state).toBe("pass");
      expect(v.rows[i]!.sentence).toMatch(/passes without stopping/);
    }
    expect(v.present.pass).toBe(true);
  });
});

describe("stripView: column headings on the circuits", () => {
  it("names the way round where both columns end at the same stop (INN)", () => {
    const v = stripView({ strip: strip("INN"), split: null, version: null, mode: "BUS" });
    expect(new Set([v.downHeading, v.upHeading])).toEqual(new Set(["Clockwise", "Anticlockwise"]));
  });

  it("keeps the ends where they differ, whatever the headsigns say (S-C, OUT)", () => {
    const sc = stripView({ strip: strip("S-C"), split: null, version: null, mode: "TRAIN" });
    expect([sc.downHeading, sc.upHeading]).toEqual([
      "To Newmarket Train Station",
      "To Pukekohe Train Station",
    ]);
    const out = stripView({ strip: strip("OUT"), split: null, version: null, mode: "BUS" });
    expect([out.downHeading, out.upHeading]).toEqual(["To Westfield Newmarket", "To St Lukes"]);
  });
});

describe("stripView: a one-way route", () => {
  const s: RouteStrip = {
    rows: ["A", "B"].map((name, i) => ({
      key: name,
      stopIds: [name],
      name,
      lane: 0,
      down: true,
      up: false,
      terminus: i === 0,
      repeats: null,
      reach: 0,
    })),
    versions: [],
    edges: [{ from: 0, to: 1, versions: [], loopLane: null }],
    trunk: null,
    down: [0],
    up: [],
    downTo: "B",
    upTo: null,
    downWay: null,
    upWay: null,
    lanes: 1,
  };

  it("reads each stop in ink with a single figure, and never flags a dashed half", () => {
    const v = stripView({ strip: s, split: null, version: null, mode: "BUS" });
    expect(v.rows.map((r) => r.bothWays)).toEqual([true, true]);
    expect(v.rows.map((r) => r.sentence)).toEqual(["A, terminus: stops here.", "B: stops here."]);
    expect(v.present.unserved).toBe(false);
  });
});
