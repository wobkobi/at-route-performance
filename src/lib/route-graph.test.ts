import { buildBranchedLine } from "@/lib/route-graph";
import type { RouteVariant } from "@/types/api";
import { describe, expect, it } from "vitest";

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

describe("buildBranchedLine", () => {
  it("returns an empty layout for no variants", () => {
    expect(buildBranchedLine([])).toEqual({
      nodes: [],
      edges: [],
      labels: [],
      width: 0,
      height: 0,
    });
  });

  it("lays the most-frequent variant out as the trunk on track 0", () => {
    const line = buildBranchedLine([variant(["a", "b"], 2), variant(["a", "b", "c", "d"], 9)]);
    // The 9-trip variant wins the trunk despite being listed second.
    const trunk = ["a", "b", "c", "d"];
    trunk.forEach((id, i) => {
      const node = line.nodes.find((n) => n.stopId === id);
      expect(node).toMatchObject({ x: i, y: 0 });
    });
    expect(line.height).toBe(1); // no branches
    expect(line.labels).toHaveLength(0);
  });

  it("adds no branch when a variant just ends early (subset of the trunk)", () => {
    const line = buildBranchedLine([
      variant(["a", "b", "c", "d", "e"], 10),
      variant(["a", "b", "c"], 3),
    ]);
    expect(line.height).toBe(1);
    expect(line.nodes.every((n) => n.y === 0)).toBe(true);
    expect(line.labels).toHaveLength(0);
  });

  it("routes a variant's unshared stops onto a branch track", () => {
    const line = buildBranchedLine([
      variant(["a", "b", "c", "d"], 10),
      variant(["a", "b", "x", "y"], 4, "via X"),
    ]);
    // Shared stops stay on the trunk.
    expect(line.nodes.find((n) => n.stopId === "a")).toMatchObject({ y: 0 });
    expect(line.nodes.find((n) => n.stopId === "b")).toMatchObject({ y: 0 });
    // The unshared stops sit on a non-zero track, labelled by headsign.
    const branchNodes = line.nodes.filter((n) => n.y > 0).map((n) => n.stopId);
    expect(branchNodes).toEqual(expect.arrayContaining(["x", "y"]));
    expect(line.height).toBeGreaterThan(1);
    expect(line.labels[0]).toMatchObject({ headsign: "via X" });
  });

  it("shares a branch stop seen across two variants rather than duplicating it", () => {
    const line = buildBranchedLine([
      variant(["a", "b", "c"], 10),
      variant(["a", "b", "z"], 5),
      variant(["a", "b", "z"], 4),
    ]);
    const zNodes = line.nodes.filter((n) => n.stopId === "z");
    expect(zNodes).toHaveLength(1);
  });
});
