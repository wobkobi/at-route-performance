// tests/lib/stop-split.test.ts
import {
  routeVersions,
  splitStopFigures,
  versionKey,
  type SplitContext,
  type StopSplitRow,
} from "@/lib/stop-split";
import type { RouteVariant } from "@/types/api";
import { describe, expect, it } from "vitest";

/**
 * A variant.
 * @param dir - Direction id.
 * @param stops - Stop ids in order.
 * @param shape - Shape id.
 * @param trips - Trip count.
 * @param headsign - Headsign.
 * @returns The variant.
 */
function variant(
  dir: number,
  stops: string[],
  shape: string,
  trips = 10,
  headsign: string | null = null,
): RouteVariant {
  return { directionId: dir, stopIds: stops, shapeId: shape, tripCount: trips, headsign };
}

/**
 * A row of sums.
 * @param stop - Stop id.
 * @param dir - Direction id.
 * @param shape - Shape id.
 * @param events - Arrivals.
 * @param dev - Deviation sum.
 * @param onTime - On-time arrivals.
 * @param headsign - Headsign.
 * @returns The row.
 */
function row(
  stop: string,
  dir: number | null,
  shape: string | null,
  events: number,
  dev: number,
  onTime = events,
  headsign: string | null = null,
): StopSplitRow {
  return {
    stop_id: stop,
    direction_id: dir,
    shape_id: shape,
    headsign,
    events,
    dev_sum: dev,
    on_time: onTime,
  };
}

// 65 in miniature: Coyle Park runs and Walker Park runs to Glen Innes and back.
const ctx: SplitContext = {
  directions: {
    0: {
      variants: [
        variant(0, ["WP", "WAK", "GI"], "walk-out", 89, "Glen Innes"),
        variant(0, ["CP", "WAK", "GI"], "coyle-out", 30, "Glen Innes"),
      ],
    },
    1: {
      variants: [
        variant(1, ["GI", "WAK", "WP"], "walk-back", 89, "Walker Park"),
        variant(1, ["GI", "WAK", "CP"], "coyle-back", 30, "Coyle Park"),
      ],
    },
  },
  directionIdAliases: new Map(),
  rawToCanon: new Map([["WAK-2", "WAK"]]),
};

describe("versionKey", () => {
  it("gives the run out and the run back one key", () => {
    expect(versionKey(variant(0, ["A", "B", "C"], "s"))).toBe(
      versionKey(variant(1, ["C", "B", "A"], "t")),
    );
  });
});

describe("routeVersions", () => {
  it("pairs the directions, busiest first, named from the lowest direction", () => {
    const vs = routeVersions(ctx.directions);
    expect(vs.map((v) => [v.from, v.to, v.tripCount])).toEqual([
      ["WP", "GI", 178],
      ["CP", "GI", 60],
    ]);
  });
});

describe("splitStopFigures", () => {
  const rows = [
    row("WAK", 0, "walk-out", 10, 600, 8),
    row("WAK-2", 0, "coyle-out", 10, -200, 10),
    row("WAK", 1, "walk-back", 4, 40),
    row("CP", 0, "coyle-out", 5, 50),
    row("GI", null, null, 3, 900, 0),
  ];
  const split = splitStopFigures(rows, ctx);

  /**
   * A stop's arrivals over both directions.
   * @param s - Stop id.
   * @returns The count.
   */
  function events(s: string): number {
    return Object.values(split.all[s] ?? {}).reduce((n, f) => n + f.events, 0);
  }

  it("sums back to each stop's totals across directions", () => {
    expect(events("WAK")).toBe(24);
    expect(events("CP")).toBe(5);
  });

  it("averages over arrivals, collapsing platforms onto the station", () => {
    expect(split.all.WAK?.[0]).toEqual({ events: 20, avg_delay_sec: 20, on_time_pct: 90 });
    expect(split.all.WAK?.[1]).toEqual({ events: 4, avg_delay_sec: 10, on_time_pct: 100 });
  });

  it("keeps each version's runs apart", () => {
    const walker = versionKey(variant(0, ["WP", "GI"], "x"));
    const coyle = versionKey(variant(0, ["CP", "GI"], "x"));
    expect(split.byVersion[walker]?.WAK?.[0]?.avg_delay_sec).toBe(60);
    expect(split.byVersion[coyle]?.WAK?.[0]?.avg_delay_sec).toBe(-20);
    expect(split.byVersion[walker]?.CP).toBeUndefined();
  });

  it("leaves out a run with no direction", () => {
    expect(split.all.GI).toBeUndefined();
  });

  it("folds a merged direction id onto its primary", () => {
    const merged = splitStopFigures([row("CP", 5, "coyle-out", 2, 20)], {
      ...ctx,
      directionIdAliases: new Map([[5, 0]]),
    });
    expect(merged.all.CP?.[0]?.events).toBe(2);
  });

  it("places a run by headsign only when that headsign names one version", () => {
    const back = splitStopFigures([row("WAK", 1, "unknown", 2, 20, 2, "Coyle Park")], ctx);
    expect(Object.keys(back.byVersion)).toEqual([versionKey(variant(0, ["CP", "GI"], "x"))]);
    const out = splitStopFigures([row("WAK", 0, "unknown", 2, 20, 2, "Glen Innes")], ctx);
    expect(out.byVersion).toEqual({});
    expect(out.all.WAK?.[0]?.events).toBe(2);
  });

  it("matches a shape folded into a merged variant", () => {
    const withMerged: SplitContext = {
      ...ctx,
      directions: {
        0: { variants: [{ ...variant(0, ["CP", "GI"], "a"), shapeIds: ["a", "b"] }] },
      },
    };
    const s = splitStopFigures([row("CP", 0, "b", 1, 0)], withMerged);
    expect(Object.keys(s.byVersion)).toHaveLength(1);
  });
});
