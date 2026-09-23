// tests/lib/stop-split.test.ts
import {
  splitStopFigures,
  type SplitContext,
  type StopSplitRow,
  type VersionVariant,
} from "@/lib/stop-split";
import { describe, expect, it } from "vitest";

/**
 * A version's variant.
 * @param dir - Direction id.
 * @param shape - Shape id.
 * @param headsign - Headsign.
 * @returns The variant.
 */
function variant(dir: number, shape: string, headsign: string | null = null): VersionVariant {
  return { directionId: dir, shapeId: shape, headsign };
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
  versions: [
    {
      key: "walker",
      variants: [variant(0, "walk-out", "Glen Innes"), variant(1, "walk-back", "Walker Park")],
    },
    {
      key: "coyle",
      variants: [variant(0, "coyle-out", "Glen Innes"), variant(1, "coyle-back", "Coyle Park")],
    },
  ],
  directionIdAliases: new Map(),
  rawToCanon: new Map([["WAK-2", "WAK"]]),
};

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
    expect(split.byVersion.walker?.WAK?.[0]?.avg_delay_sec).toBe(60);
    expect(split.byVersion.coyle?.WAK?.[0]?.avg_delay_sec).toBe(-20);
    expect(split.byVersion.walker?.CP).toBeUndefined();
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
    expect(Object.keys(back.byVersion)).toEqual(["coyle"]);
    const out = splitStopFigures([row("WAK", 0, "unknown", 2, 20, 2, "Glen Innes")], ctx);
    expect(out.byVersion).toEqual({});
    expect(out.all.WAK?.[0]?.events).toBe(2);
  });

  it("matches a shape folded into a merged variant", () => {
    const withMerged: SplitContext = {
      ...ctx,
      versions: [{ key: "coyle", variants: [{ ...variant(0, "a"), shapeIds: ["a", "b"] }] }],
    };
    const s = splitStopFigures([row("CP", 0, "b", 1, 0)], withMerged);
    expect(Object.keys(s.byVersion)).toEqual(["coyle"]);
  });

  it("matches a shape only within the run's direction", () => {
    const s = splitStopFigures([row("WAK", 1, "walk-out", 1, 0)], ctx);
    expect(s.byVersion).toEqual({});
  });
});
