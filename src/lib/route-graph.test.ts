// src/lib/route-graph.test.ts
/**
 * @description Tests the branched snake diagram layout in route-graph.ts.
 */
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
  branchDrop: 8,
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
  return { stopIds, tripCount, headsign, directionId: 0, shapeId: null };
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
      trunkHeadsign: null,
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

  it("labels alternate off the line by within-row index, each row restarting down", () => {
    // cols 3: a,b,c on row0 (within 0,1,2), d starts row1 at within 0. labelDir is
    // the preferred side; DiagramSvg's resolver flips it where a line/label blocks it.
    const line = buildBranchedSnake([variant(["a", "b", "c", "d"], 5)], OPTS);
    const byId = new Map(line.nodes.map((n) => [n.stopId, n.labelDir]));
    expect(byId.get("a")).toBe("down"); // within 0: below, so the title owns the space above
    expect(byId.get("b")).toBe("up"); // within 1: above
    expect(byId.get("c")).toBe("down"); // within 2: below
    expect(byId.get("d")).toBe("down"); // next row restarts at within 0 > below
  });

  it("adds no branch when a variant just ends early (prefix of the trunk)", () => {
    const line = buildBranchedSnake(
      [variant(["a", "b", "c", "d"], 10), variant(["a", "b", "c"], 4)],
      OPTS,
    );
    expect(line.nodes.every((n) => n.branch === 0)).toBe(true);
    expect(line.labels).toHaveLength(0);
  });

  it("forks a substantial divergent tail: 45deg out, then horizontal", () => {
    const line = buildBranchedSnake(
      [variant(["a", "b", "c", "d", "e"], 10), variant(["a", "b", "x", "y", "z"], 4, "via X")],
      OPTS,
    );
    const branchNodes = line.nodes.filter((n) => n.branch > 0);
    expect(branchNodes.map((n) => n.stopId)).toEqual(["x", "y", "z"]);
    // Branch stops share one horizontal lane off the trunk.
    const laneY = branchNodes[0].cy;
    expect(branchNodes.every((n) => n.cy === laneY)).toBe(true);
    const branches = line.edges.filter((e) => e.branch);
    expect(branches).toHaveLength(3);
    // The connector leaves the trunk at 45deg (equal run/rise); the rest are flat.
    const [connector, ...rest] = branches;
    expect(Math.abs(connector.x2 - connector.x1)).toBe(Math.abs(connector.y2 - connector.y1));
    expect(rest.every((e) => e.y1 === e.y2)).toBe(true);
    expect(line.labels[0]).toMatchObject({ headsign: "via X" });
  });

  it("stacks two branches off the same row into deeper lanes below it", () => {
    const line = buildBranchedSnake(
      [
        variant(["a", "b", "c", "d", "e", "f"], 10),
        variant(["a", "b", "x", "y", "z"], 5, "via X"),
        variant(["a", "b", "c", "p", "q", "r"], 4, "via P"),
      ],
      OPTS,
    );
    // Trunk row 0 baseline (both branches fork from a stop on it).
    const baseCy = line.nodes.find((n) => n.stopId === "a")!.cy;
    const first = line.nodes.filter((n) => n.branch === 1);
    const second = line.nodes.filter((n) => n.branch === 2);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    // Both run below the trunk; the second stacks into a deeper lane.
    expect(first.every((n) => n.cy > baseCy)).toBe(true);
    expect(second.every((n) => n.cy > first[0].cy)).toBe(true);
  });

  it("forks a convergent variant (shared destination, different origin) in, not separate", () => {
    // Both run to d via c; the second starts elsewhere (m, n) - it should fork
    // into the trunk at the convergence stop, not be split off as a separate line.
    const line = buildBranchedSnake(
      [variant(["a", "b", "c", "d"], 10), variant(["m", "n", "c", "d"], 4, "from M")],
      OPTS,
    );
    expect(line.separate).toEqual([]);
    const branch = line.nodes.filter((n) => n.branch > 0);
    expect(branch.map((n) => n.stopId)).toEqual(expect.arrayContaining(["m", "n"]));
    // The distinct origin forks in to the left of the convergence stop (c).
    const convergeX = line.nodes.find((n) => n.stopId === "c")!.cx;
    expect(branch.every((n) => n.cx < convergeX)).toBe(true);
    expect(line.labels[0]).toMatchObject({ headsign: "from M", toLeft: true });
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

  it("staggered connectors: two forks from the same anchor produce distinct connector start points", () => {
    const line = buildBranchedSnake(
      [
        variant(["a", "b", "c", "d", "e", "f"], 20),
        variant(["a", "b", "x", "y", "z"], 5, "via X"),
        variant(["a", "b", "p", "q", "r"], 3, "via P"),
      ],
      OPTS,
    );
    // Diagonal (45°) connector edges have |dy| === branchDrop; horizontal branch
    // edges have dy === 0.
    const connectors = line.edges.filter(
      (e) => e.branch && Math.abs(e.y2 - e.y1) === OPTS.branchDrop,
    );
    expect(connectors).toHaveLength(2);
    // Sort by y1 so lane 0 (inner, closer to trunk) is first.
    const [inner, outer] = connectors.sort((a, b) => a.y1 - b.y1);
    // Inner connector starts at the trunk anchor.
    const anchor = line.nodes.find((n) => n.stopId === "b" && n.branch === 0)!;
    expect(inner.x1).toBe(anchor.cx);
    expect(inner.y1).toBe(anchor.cy);
    // Outer connector starts where the inner one ends (NOT at the trunk anchor).
    expect(outer.x1).toBe(inner.x2);
    expect(outer.y1).toBe(inner.y2);
    // Each connector is exactly one branchDrop diagonal step.
    expect(Math.abs(inner.x2 - inner.x1)).toBe(OPTS.branchDrop);
    expect(Math.abs(inner.y2 - inner.y1)).toBe(OPTS.branchDrop);
    expect(Math.abs(outer.x2 - outer.x1)).toBe(OPTS.branchDrop);
    expect(Math.abs(outer.y2 - outer.y1)).toBe(OPTS.branchDrop);
  });

  it("divergent branch on odd trunk row extends leftward (trunk travel direction)", () => {
    // With cols=3 the trunk wraps: row 0 left>right (stops 0-2), row 1 right>left
    // (stops 3-5). A divergent fork anchored on row 1 must go left, not right.
    const line = buildBranchedSnake(
      [
        variant(["a", "b", "c", "d", "e", "f", "g"], 20),
        variant(["a", "b", "c", "d", "x", "y", "z"], 5, "via X"),
      ],
      OPTS,
    );
    const anchor = line.nodes.find((n) => n.stopId === "d" && n.branch === 0)!;
    const branchNodes = line.nodes.filter((n) => n.branch > 0);
    // Every branch stop must sit to the left of the anchor.
    expect(branchNodes[0].cx).toBeLessThan(anchor.cx);
    for (let i = 1; i < branchNodes.length; i++) {
      expect(branchNodes[i].cx).toBeLessThan(branchNodes[i - 1].cx);
    }
    // The 45° connector must go leftward.
    const connector = line.edges.find(
      (e) => e.branch && Math.abs(e.y2 - e.y1) === OPTS.branchDrop,
    )!;
    expect(connector.x2).toBeLessThan(connector.x1);
    // Label sits to the left because hDir < 0.
    expect(line.labels[0]).toMatchObject({ toLeft: true });
  });

  it("convergent branch label has toUp: true", () => {
    const line = buildBranchedSnake(
      [variant(["a", "b", "c", "d"], 10), variant(["m", "n", "c", "d"], 4, "from M")],
      OPTS,
    );
    expect(line.labels[0]).toMatchObject({ toUp: true });
  });

  it("convergent branch omits stops already on the trunk, preventing duplicate nodes", () => {
    // The trunk starts at "mangere_tc". A convergent variant also passes through
    // "mangere_tc" in its unique head before joining the trunk. Without the
    // trunk-dedup filter "mangere_tc" would be placed at two different positions;
    // with it the stop appears exactly once (on the trunk) and the branch only
    // carries the genuinely unique stop "x".
    const line = buildBranchedSnake(
      [
        variant(["mangere_tc", "b", "c", "d", "e"], 10),
        variant(["x", "mangere_tc", "c", "d", "e"], 4, "from X"),
      ],
      OPTS,
    );
    const mangereNodes = line.nodes.filter((n) => n.stopId === "mangere_tc");
    expect(mangereNodes).toHaveLength(1);
    expect(mangereNodes[0].branch).toBe(0); // trunk only
    const branchNodes = line.nodes.filter((n) => n.branch > 0);
    expect(branchNodes.map((n) => n.stopId)).toEqual(["x"]);
  });

  it("convergent and divergent forks from the same anchor stay in separate lanes", () => {
    const line = buildBranchedSnake(
      [
        variant(["a", "b", "c", "d", "e"], 10),
        variant(["m", "n", "b", "c", "d", "e"], 4, "from M"),
        variant(["a", "b", "x", "y", "z"], 3, "via X"),
      ],
      OPTS,
    );
    expect(line.separate).toEqual([]);
    const anchor = line.nodes.find((n) => n.stopId === "b" && n.branch === 0)!;
    const convergentNodes = line.nodes.filter((n) => ["m", "n"].includes(n.stopId));
    const divergentNodes = line.nodes.filter((n) => ["x", "y", "z"].includes(n.stopId));
    expect(convergentNodes).toHaveLength(2);
    expect(divergentNodes).toHaveLength(3);
    // Convergent (upward) fork sits above the trunk.
    expect(convergentNodes.every((n) => n.cy < anchor.cy)).toBe(true);
    // Divergent (downward) fork sits below the trunk.
    expect(divergentNodes.every((n) => n.cy > anchor.cy)).toBe(true);
    // Each direction has one 45° connector; they go in opposite vertical directions.
    const connectors = line.edges.filter(
      (e) => e.branch && Math.abs(e.y2 - e.y1) === OPTS.branchDrop,
    );
    expect(connectors).toHaveLength(2);
    expect(connectors.some((e) => e.y2 < e.y1)).toBe(true); // convergent goes up
    expect(connectors.some((e) => e.y2 > e.y1)).toBe(true); // divergent goes down
    // Labels carry the correct nudge hints.
    const convergentLabel = line.labels.find((l) => l.headsign === "from M")!;
    const divergentLabel = line.labels.find((l) => l.headsign === "via X")!;
    expect(convergentLabel).toMatchObject({ toUp: true });
    expect(divergentLabel.toUp).toBeFalsy();
  });
});
