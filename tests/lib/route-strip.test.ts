// tests/lib/route-strip.test.ts
import {
  buildStrip,
  closedRuns,
  layoutStrip,
  mergeOrder,
  pickBreaks,
  rowFigure,
  STRIP_LANE,
  STRIP_ROW,
  stripSegments,
  type RouteStrip,
  type StripRow,
  type StripSegment,
} from "@/lib/route-strip";
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
 * The row with a name, the first if there are two.
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
 * Where a segment's ends are.
 * @param g - The segment.
 * @returns Its two ends as `x,y` keys.
 */
function endsOf(g: StripSegment): string[] {
  return [`${g.x1},${g.y1}`, `${g.x2},${g.y2}`];
}

const SLUGS = Object.keys(views);

describe("mergeOrder", () => {
  it("keeps each list's order and puts the stop met first ahead", () => {
    expect(
      mergeOrder([
        ["A", "B", "D"],
        ["A", "C", "D"],
      ]),
    ).toEqual(["A", "B", "C", "D"]);
  });

  it("forces the stop met first in when the lists disagree", () => {
    expect(
      mergeOrder([
        ["A", "B", "C"],
        ["C", "B", "A"],
      ]),
    ).toEqual(["A", "B", "C"]);
  });
});

describe("buildStrip on 65", () => {
  const s = strip("65");
  const names = s.rows.map((r) => r.name);

  it("puts Coyle Park on the straight line and the Selwyn and Walker Park stops on a track", () => {
    const from = rowOf(s, "Target Street");
    expect(names.slice(from, from + 8)).toEqual([
      "Target Street",
      "Selwyn Village",
      "Katoa Street",
      "Betty Pyatt Apartments",
      "Maranui Avenue",
      "Muripara Avenue",
      "Walker Park",
      "Wakatipu Street",
    ]);
    expect(names[0]).toBe("Coyle Park");
    expect(s.trunk).toBe("coyle-park-to-glen-innes-station");
    for (let i = from + 1; i < from + 7; i++) expect(s.rows[i]!.lane, names[i]).toBe(1);
    expect(s.rows[rowOf(s, "Wakatipu Street")]!.lane).toBe(0);
    expect(s.lanes).toBe(2);
  });

  it("merges a stop's two sides of the road into one row", () => {
    expect(s.rows[rowOf(s, "Walker Park")]!.stopIds).toHaveLength(2);
    expect(s.rows[0]!.stopIds).toHaveLength(2);
    expect(names.filter((n) => n === "Wakatipu Street")).toHaveLength(1);
  });

  it("marks where each version starts and ends", () => {
    const termini = s.rows.filter((r) => r.terminus).map((r) => r.name);
    expect(termini).toEqual(["Coyle Park", "Selwyn Village", "Walker Park", "Glen Innes Station"]);
  });

  it("keeps stops paired across the road under different names apart, down first", () => {
    const potters = s.rows[rowOf(s, "Potters Park")]!;
    const dominion = s.rows[rowOf(s, "Balmoral Road/Dominion Road")]!;
    expect([potters.down, potters.up]).toEqual([true, false]);
    expect([dominion.down, dominion.up]).toEqual([false, true]);
    expect(rowOf(s, "Potters Park")).toBeLessThan(rowOf(s, "Balmoral Road/Dominion Road"));
  });

  it("names the shared end each way, and none where the versions end apart", () => {
    expect(s.downTo).toBe("Glen Innes Station");
    expect(s.upTo).toBeNull();
    expect(s.down).toEqual([0]);
    expect(s.up).toEqual([1]);
  });

  it("lists the versions top of the strip first, each with both directions' variants", () => {
    expect(s.versions.map((v) => [v.from, v.tripCount, v.minor])).toEqual([
      ["Coyle Park", 50, false],
      ["Selwyn Village", 86, false],
      ["Walker Park", 204, false],
    ]);
    for (const v of s.versions) {
      expect(new Set(v.variants.map((x) => x.directionId))).toEqual(new Set([0, 1]));
      // Each version runs down to Glen Innes and back up to its own start.
      expect([v.downTo, v.upTo]).toEqual(["Glen Innes Station", v.from]);
    }
  });

  it("draws the track once, joining the straight line at 45 degrees", () => {
    const segs = stripSegments(s);
    const wak = rowOf(s, "Wakatipu Street") * STRIP_ROW;
    const join = segs.find((g) => g.x2 === 0 && g.y2 === wak && g.x1 === STRIP_LANE);
    expect(join?.y1).toBe(wak - STRIP_LANE);
    expect(join?.versions).toEqual([
      "selwyn-village-to-glen-innes-station",
      "walker-park-to-glen-innes-station",
    ]);
    const below = segs.find((g) => g.x1 === 0 && g.y1 === wak);
    expect(below?.versions).toHaveLength(3);
  });
});

describe("buildStrip on S-C", () => {
  const s = strip("S-C");

  it("draws the city loop as a lasso off Newmarket", () => {
    const anchor = rowOf(s, "Newmarket Train Station");
    const loop = s.edges.filter((e) => e.loopLane !== null);
    expect(loop).toHaveLength(1);
    expect(loop[0]).toMatchObject({
      from: anchor,
      to: rowOf(s, "Parnell Train Station"),
      loopLane: 1,
    });
    expect(s.rows.slice(anchor + 1).map((r) => r.name)).toEqual([
      "Grafton Train Station",
      "Karanga-a-Hape Train Station",
      "Te Waihorotiu Train Station",
      "Waitemata Train Station",
      "Parnell Train Station",
    ]);
    expect(s.rows.every((r) => r.lane === 0)).toBe(true);
    expect(s.rows.slice(anchor + 1).every((r) => r.reach === 1)).toBe(true);
  });

  it("turns the loop back in a half circle past its last stop", () => {
    const arcs = stripSegments(s).filter((g) => g.kind === "arc");
    expect(arcs).toHaveLength(1);
    expect(arcs[0]).toMatchObject({ x1: 0, x2: STRIP_LANE, arc: { sweep: 0 } });
  });
});

describe("buildStrip on NX1", () => {
  const s = strip("NX1");

  it("runs a straight line from Hibiscus Coast with Albany as a terminus on it", () => {
    expect(s.rows[0]!.name).toBe("Hibiscus Coast");
    expect(s.lanes).toBe(1);
    expect(s.rows[rowOf(s, "Albany Bus Station")]!.terminus).toBe(true);
    expect(rowOf(s, "Customs Street West")).toBeLessThan(rowOf(s, "Bradnor Lane"));
  });

  it("lists the one-run short workings as minor, after the others", () => {
    expect(s.versions.map((v) => v.minor)).toEqual([false, false, true, true]);
    expect(s.versions.filter((v) => v.minor).map((v) => v.from)).toEqual(
      expect.arrayContaining(["Smales Farm", "Akoranga"]),
    );
    expect(s.rows[rowOf(s, "Smales Farm")]!.terminus).toBe(false);
  });
});

describe("buildStrip on OUT", () => {
  const s = strip("OUT");
  const names = s.rows.map((r) => r.name);

  it("is one version, paired across its different ends", () => {
    expect(s.versions).toHaveLength(1);
    expect(s.versions[0]!.tripCount).toBe(495);
  });

  it("ends up the page at Mahuru Street, which only the run back serves", () => {
    const last = s.rows.at(-1)!;
    expect(last.name).toBe("Mahuru Street");
    expect([last.down, last.up]).toEqual([false, true]);
    expect(s.upTo).toBe("St Lukes");
  });

  it("orders the one-way stops as the runs pass them", () => {
    expect(rowOf(s, "Lloyd Avenue")).toBe(rowOf(s, "Mount Albert Shops") - 1);
    const shops = s.rows[rowOf(s, "Mount Albert Shops")]!;
    expect([shops.down, shops.up]).toEqual([false, true]);
    const from = rowOf(s, "Gudgeon Street");
    expect(names.slice(from, from + 8)).toEqual([
      "Gudgeon Street",
      "England Street",
      "Franklin Road",
      "Victoria Park Market",
      "Sale Street",
      "International Convention Centre",
      "Nelson Street",
      "Te Waihorotiu Station",
    ]);
  });
});

describe("buildStrip on the plain routes", () => {
  it("lays 20 out as one line", () => {
    const s = strip("20");
    expect(s.lanes).toBe(1);
    expect(s.versions).toHaveLength(1);
    expect(s.edges.every((e) => e.loopLane === null)).toBe(true);
  });

  it("lists 70's short runs as minor, with no track", () => {
    const s = strip("70");
    expect(s.lanes).toBe(1);
    expect(s.versions.map((v) => v.minor)).toEqual([false, true, true, true]);
  });

  it("keeps EAST's short run to Otahuhu on the line", () => {
    const s = strip("EAST");
    expect(s.lanes).toBe(1);
    expect(s.versions.map((v) => v.minor)).toEqual([false, true]);
  });
});

describe("buildStrip on INN", () => {
  const s = strip("INN");

  it("draws the circuit as a line whose last row repeats the first", () => {
    const first = s.rows[0]!;
    const last = s.rows.at(-1)!;
    expect(first.name).toBe("Victoria Park Market");
    expect(last).toMatchObject({ name: "Victoria Park Market", repeats: first.key });
    expect(last.key).toBe(`${first.key}~end`);
    expect(s.lanes).toBe(1);
    expect(s.edges.every((e) => e.loopLane === null)).toBe(true);
  });

  it("visits a stop passed twice once", () => {
    expect(s.rows.filter((r) => r.name === "Westfield Newmarket")).toHaveLength(1);
  });

  it("pairs the short runs that share their ends, and no others", () => {
    expect(s.versions.map((v) => [v.from, v.to, v.tripCount])).toEqual([
      ["Victoria Park Market", "Victoria Park Market", 587],
      ["Karanga-a-Hape Station", "Victoria Park Market", 13],
      ["Clovernook Road", "Victoria Park Market", 10],
      ["Queens Arcade", "Victoria Park Market", 4],
    ]);
  });
});

describe("the strip's geometry", () => {
  it.each(SLUGS)("%s: every piece meets a ring or another piece, and none overlap", (slug) => {
    const s = strip(slug);
    const segs = stripSegments(s);
    const rings = new Set(s.rows.map((r, i) => `${r.lane * STRIP_LANE},${i * STRIP_ROW}`));
    const count = new Map<string, number>();
    for (const g of segs) for (const e of endsOf(g)) count.set(e, (count.get(e) ?? 0) + 1);
    for (const g of segs) {
      for (const e of endsOf(g))
        expect(rings.has(e) || count.get(e)! > 1, `${slug} ${e}`).toBe(true);
    }
    const lines = segs.filter((g) => g.kind === "line");
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const a = lines[i]!;
        const b = lines[j]!;
        const dxa = (a.x2 - a.x1) / (a.y2 - a.y1);
        const dxb = (b.x2 - b.x1) / (b.y2 - b.y1);
        const collinear = dxa === dxb && a.x1 - dxa * a.y1 === b.x1 - dxb * b.y1;
        const overlap = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
        expect(collinear && overlap > 0, `${slug} overlap at y ${a.y1}`).toBe(false);
      }
    }
  });

  it.each(SLUGS)("%s: every edge's versions are on the line under it", (slug) => {
    const s = strip(slug);
    const segs = stripSegments(s);
    for (const e of s.edges) {
      if (e.loopLane !== null) continue;
      const y = ((e.from + e.to) / 2) * STRIP_ROW;
      const under = segs.filter((g) => g.kind === "line" && g.y1 <= y && g.y2 >= y);
      for (const v of e.versions) expect(under.some((g) => g.versions.includes(v))).toBe(true);
    }
  });

  it.each(SLUGS)("%s: breaks fall only where the straight line crosses alone", (slug) => {
    const s = strip(slug);
    const segs = stripSegments(s);
    for (let cols = 2; cols <= 6; cols++) {
      const breaks = pickBreaks(s, cols);
      expect(breaks).toEqual([...breaks].sort((a, b) => a - b));
      for (const b of breaks) {
        const mid = (b - 0.5) * STRIP_ROW;
        const crossing = segs.filter(
          (g) =>
            Math.min(g.y1, g.y2) < mid && Math.max(g.y1, g.y2, g.arc ? g.y1 + g.arc.r : 0) > mid,
        );
        expect(crossing.every((g) => g.kind === "line" && g.x1 === 0 && g.x2 === 0)).toBe(true);
      }
    }
  });

  it("keeps breaks out of a track and a loop, and out of a span ruled out", () => {
    const s65 = strip("65");
    const track = [rowOf(s65, "Selwyn Village"), rowOf(s65, "Wakatipu Street")] as const;
    for (let cols = 2; cols <= 12; cols++) {
      for (const b of pickBreaks(s65, cols)) expect(b <= track[0] || b > track[1]).toBe(true);
    }
    const sc = strip("S-C");
    const anchor = rowOf(sc, "Newmarket Train Station");
    for (let cols = 2; cols <= 12; cols++) {
      for (const b of pickBreaks(sc, cols)) expect(b <= anchor).toBe(true);
    }
    const out = strip("OUT");
    const free = pickBreaks(out, 2)[0]!;
    const ruled = pickBreaks(out, 2, [[free - 3, free + 3]])[0]!;
    expect(ruled <= free - 3 || ruled > free + 3).toBe(true);
  });
});

describe("layoutStrip", () => {
  const s = strip("65");
  const dims = { top: 20, left: 14, tail: 10 };

  it("gives every row one ring, column by column", () => {
    const breaks = pickBreaks(s, 3);
    const cols = layoutStrip(s, breaks, dims);
    expect(cols).toHaveLength(3);
    expect(cols.flatMap((c) => c.rows.map((r) => r.index))).toEqual(s.rows.map((_, i) => i));
    for (const c of cols) expect(c.rows[0]!.y).toBe(dims.top);
  });

  it("runs the line on past a break as a tail each side", () => {
    const [b] = pickBreaks(s, 2);
    const [upper, lower] = layoutStrip(s, [b!], dims);
    const lastY = upper!.rows.at(-1)!.y;
    expect(upper!.pieces.some((p) => p.to[0] === dims.left && p.to[1] === lastY + dims.tail)).toBe(
      true,
    );
    expect(
      lower!.pieces.some((p) => p.from[0] === dims.left && p.from[1] === dims.top - dims.tail),
    ).toBe(true);
  });

  it("joins a track and its 45 degree step into one path when they carry the same versions", () => {
    const cols = layoutStrip(s, [], dims);
    const step = cols[0]!.pieces.find((p) => p.d.includes(" L ") && p.d.split(" L ").length === 3);
    expect(step?.versions).toEqual([
      "selwyn-village-to-glen-innes-station",
      "walker-park-to-glen-innes-station",
    ]);
  });

  it("draws S-C as one path, round the loop and back into Newmarket", () => {
    const sc = strip("S-C");
    const [col] = layoutStrip(sc, [], dims);
    expect(col!.pieces).toHaveLength(1);
    const [path] = col!.pieces;
    expect(path!.d).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ A 12 12 0 0 0 [\d.]+ [\d.]+ L /);
    const anchor = rowOf(sc, "Newmarket Train Station");
    expect(path!.to).toEqual([dims.left, dims.top + anchor * STRIP_ROW]);
  });
});

describe("closedRuns", () => {
  /**
   * A row for the closure tests.
   * @param key - The row's key.
   * @param down - Served down the page.
   * @param up - Served up it.
   * @returns The row.
   */
  function row(key: string, down: boolean, up: boolean): StripRow {
    return {
      key,
      stopIds: [key],
      name: key,
      lane: 0,
      down,
      up,
      terminus: false,
      repeats: null,
      reach: 0,
    };
  }
  const rows = [
    row("a", true, true),
    row("lloyd", true, false),
    row("shops", false, true),
    row("benfield", true, true),
    row("next", true, true),
    row("far", true, true),
  ];

  it("stretches a run over a neighbour the direction never serves", () => {
    expect(closedRuns(rows, "down", new Set(["benfield"]))).toEqual([[2, 3]]);
    expect(closedRuns(rows, "up", new Set(["benfield"]))).toEqual([[3, 3]]);
  });

  it("joins closed rows next to each other into one run", () => {
    expect(closedRuns(rows, "down", new Set(["benfield", "next", "a"]))).toEqual([
      [0, 0],
      [2, 4],
    ]);
  });
});

describe("rowFigure", () => {
  it("combines a row's ids and a column's directions, weighted by arrivals", () => {
    const figures = {
      x: { 0: { events: 30, avg_delay_sec: 60, on_time_pct: 50 } },
      y: {
        0: { events: 10, avg_delay_sec: -20, on_time_pct: 100 },
        1: { events: 99, avg_delay_sec: 999, on_time_pct: 0 },
      },
    };
    expect(rowFigure(figures, { stopIds: ["x", "y"] }, [0])).toEqual({
      events: 40,
      avg_delay_sec: 40,
      on_time_pct: 62.5,
    });
    expect(rowFigure(figures, { stopIds: ["z"] }, [0])).toBeNull();
  });
});
