import { buildBranchedSnake, type SnakeOpts } from "@/lib/route-graph";
import type { RouteVariant } from "@/types/api";
import { describe, expect, it } from "vitest";

const OPTS: SnakeOpts = {
  cols: 3,
  col: 10,
  row: 20,
  padX: 5,
  padTop: 5,
  padBottom: 5,
  branchStep: 8,
};

/**
 * Build a RouteVariant for tests.
 * @param stopIds - Ordered stop ids.
 * @param tripCount - Number of trips running this pattern.
 * @param headsign - Optional headsign.
 * @returns A RouteVariant.
 */
function variant(
  stopIds: string[],
  tripCount: number,
  headsign: string | null = null,
): RouteVariant {
  return { stopIds, tripCount, headsign, directionId: 0 };
}

describe("buildBranchedSnake", () => {
  it("returns an empty layout for no variants", () => {
    expect(buildBranchedSnake([], OPTS)).toEqual({
      nodes: [],
      edges: [],
      labels: [],
      width: 0,
      height: 0,
      separate: [],
    });
  });

  it("snake-wraps the trunk, turning vertically at the row end", () => {
    // 4 stops, 3 cols: row0 = a,b,c (left>right); row1 starts at the same column as c.
    const line = buildBranchedSnake([variant(["a", "b", "c", "d"], 5)], OPTS);
    expect(line.nodes.every((n) => n.branch === 0)).toBe(true);
    const c = line.nodes.find((n) => n.stopId === "c")!;
    const d = line.nodes.find((n) => n.stopId === "d")!;
    expect(d.cx).toBe(c.cx); // turn is a vertical step
    expect(d.cy).toBe(c.cy + OPTS.row);
    expect(line.labels).toHaveLength(0);
  });

  it("adds no branch when a variant just ends early (prefix of the trunk)", () => {
    const line = buildBranchedSnake(
      [variant(["a", "b", "c", "d"], 10), variant(["a", "b", "c"], 4)],
      OPTS,
    );
    expect(line.nodes.every((n) => n.branch === 0)).toBe(true);
    expect(line.labels).toHaveLength(0);
  });

  it("forks a substantial divergent tail off the trunk on a 45deg diagonal", () => {
    const line = buildBranchedSnake(
      [variant(["a", "b", "c", "d"], 10), variant(["a", "b", "x", "y", "z"], 4, "via X")],
      OPTS,
    );
    const branchNodes = line.nodes.filter((n) => n.branch > 0).map((n) => n.stopId);
    expect(branchNodes).toEqual(["x", "y", "z"]);
    // Every branch edge is a true 45deg segment (equal x and y deltas).
    const diagonals = line.edges.filter((e) => e.diagonal);
    expect(diagonals.length).toBeGreaterThan(0);
    for (const e of diagonals) {
      expect(Math.abs(e.x2 - e.x1)).toBe(Math.abs(e.y2 - e.y1));
    }
    expect(line.labels[0]).toMatchObject({ headsign: "via X" });
  });

  it("does not fork a tiny (1-2 stop) divergence", () => {
    const line = buildBranchedSnake(
      [variant(["a", "b", "c", "d"], 10), variant(["a", "b", "x", "y"], 4, "via X")],
      OPTS,
    );
    expect(line.nodes.every((n) => n.branch === 0)).toBe(true);
    expect(line.labels).toHaveLength(0);
  });

  it("returns a variant that shares no leading stop as a separate line", () => {
    // A separate pattern (different origin) is not drawn as a stray branch; it
    // is handed back in `separate` to render as its own line.
    const elsewhere = variant(["m", "n", "o"], 5, "elsewhere");
    const line = buildBranchedSnake([variant(["a", "b", "c", "d"], 10), elsewhere], OPTS);
    expect(line.nodes.every((n) => n.branch === 0)).toBe(true);
    expect(line.labels).toHaveLength(0);
    expect(line.separate).toEqual([elsewhere]);
  });
});
