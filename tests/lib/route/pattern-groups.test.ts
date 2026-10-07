// tests/lib/route/pattern-groups.test.ts
// Tests how trips are grouped into a route's stopping patterns.
import {
  MAX_PATTERNS,
  patternVariants,
  toRoutePattern,
  topPatternGroups,
  type PatternTrip,
} from "@/lib/route/pattern-groups";
import type { RouteVariant } from "@/types/api";
import { describe, expect, it } from "vitest";

/**
 * Build a trip on one (direction, shape) pattern.
 * @param tripId - Trip id.
 * @param directionId - Direction, or null when the feed gives none.
 * @param shapeId - Shape id.
 * @returns A PatternTrip.
 */
function trip(tripId: string, directionId: number | null, shapeId: string | null): PatternTrip {
  return { tripId, directionId, shapeId, headsign: `to ${shapeId}` };
}

describe("topPatternGroups", () => {
  it("groups by direction and shape, counts the trips and keeps the first as representative", () => {
    const groups = topPatternGroups([
      trip("a1", 0, "A"),
      trip("b1", 1, "B"),
      trip("a2", 0, "A"),
      trip("a3", 0, "A"),
    ]);
    expect(groups).toEqual([
      { directionId: 0, headsign: "to A", tripId: "a1", shapeId: "A", count: 3 },
      { directionId: 1, headsign: "to B", tripId: "b1", shapeId: "B", count: 1 },
    ]);
  });

  it("counts a trip with no direction as direction 0", () => {
    const groups = topPatternGroups([trip("x", null, "A"), trip("y", 0, "A")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ directionId: 0, count: 2 });
  });

  it("keeps only the most frequent groups", () => {
    const trips = Array.from({ length: MAX_PATTERNS + 2 }, (_, i) =>
      Array.from({ length: i + 1 }, (_, n) => trip(`s${i}-${n}`, 0, `s${i}`)),
    ).flat();
    const groups = topPatternGroups(trips);
    expect(groups).toHaveLength(MAX_PATTERNS);
    expect(groups.map((g) => g.shapeId)).not.toContain("s0");
    expect(groups[0]?.shapeId).toBe(`s${MAX_PATTERNS + 1}`);
  });
});

describe("patternVariants", () => {
  it("drops a group whose trip has fewer than two stops or none read", () => {
    const groups = topPatternGroups([trip("a", 0, "A"), trip("b", 0, "B"), trip("c", 1, "C")]);
    const stops = new Map([
      ["a", ["s1", "s2"]],
      ["b", ["s1"]],
    ]);
    const variants = patternVariants(groups, (id) => stops.get(id));
    expect(variants).toEqual([
      { headsign: "to A", directionId: 0, tripCount: 1, stopIds: ["s1", "s2"], shapeId: "A" },
    ]);
  });
});

describe("toRoutePattern", () => {
  it("gathers variants by direction, most frequent first", () => {
    /**
     * Build a two-stop variant.
     * @param directionId - Its direction.
     * @param tripCount - How many trips run it.
     * @returns A RouteVariant.
     */
    const v = (directionId: number, tripCount: number): RouteVariant => ({
      headsign: null,
      directionId,
      tripCount,
      stopIds: ["a", "b"],
      shapeId: null,
    });
    expect(toRoutePattern([v(0, 2), v(1, 5), v(0, 9)])).toEqual({
      directions: { 0: { variants: [v(0, 9), v(0, 2)] }, 1: { variants: [v(1, 5)] } },
    });
  });
});
