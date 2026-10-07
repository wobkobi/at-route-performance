// tests/lib/feed/ingest.test.ts
// Tests the pure op builders behind the GTFS static sync.
import { mapRouteType, type RouteAttr } from "@/lib/feed/at-static";
import { patternUpsertOps, routeUpsertOps } from "@/lib/feed/ingest";
import { describe, expect, it, vi } from "vitest";

// The sync module wires a Prisma client at import; these tests never touch it.
vi.mock("@/lib/db", () => ({ prisma: {} }));

const SEEN_AT = new Date("2026-09-12T01:00:00.000Z");

/**
 * Build a route as AT publishes it, with overrides for the case under test.
 * @param overrides - Fields to change from the default bus route.
 * @returns A RouteAttr.
 */
function route(overrides: Partial<RouteAttr> = {}): RouteAttr {
  return {
    route_id: "NX1-203",
    route_long_name: "Northern Express 1",
    route_type: 3,
    ...overrides,
  };
}

describe("routeUpsertOps", () => {
  it("stamps lastSeenAt as an extended-JSON date, never a Date instance", () => {
    const [op] = routeUpsertOps([route()], SEEN_AT);
    if (op === undefined) throw new Error("expected one op");
    expect(op.u.$set.lastSeenAt).toEqual({ $date: SEEN_AT.toISOString() });
    expect(op.u.$set.lastSeenAt).not.toBeInstanceOf(Date);
  });

  it("keys each op on the route id and sets every field the directory reads", () => {
    const [op] = routeUpsertOps(
      [
        route({
          agency_id: "TZG",
          route_short_name: "NX1",
          route_color: "#1E90FF",
          route_text_color: "#FFFFFF",
        }),
      ],
      SEEN_AT,
    );
    if (op === undefined) throw new Error("expected one op");
    expect(op.q).toEqual({ _id: "NX1-203" });
    expect(op.u.$set).toMatchObject({
      shortName: "NX1",
      longName: "Northern Express 1",
      mode: mapRouteType(3),
      colour: "1E90FF",
      textColour: "FFFFFF",
      agencyId: "TZG",
    });
  });

  it("stores null for absent optional fields", () => {
    const [op] = routeUpsertOps([route()], SEEN_AT);
    if (op === undefined) throw new Error("expected one op");
    expect(op.u.$set).toMatchObject({ shortName: null, colour: null, textColour: null });
  });

  it("drops routes with no id or no long name", () => {
    const ops = routeUpsertOps(
      [route({ route_id: "" }), route({ route_long_name: "" }), route({ route_id: "OK-1" })],
      SEEN_AT,
    );
    expect(ops.map((o) => o.q._id)).toEqual(["OK-1"]);
  });
});

describe("patternUpsertOps", () => {
  const variant = {
    headsign: "Britomart",
    directionId: 0,
    tripCount: 40,
    stopIds: ["a", "b"],
    shapeId: "s1",
  };

  it("keys each op on the versioned route id and stamps syncedAt as extended JSON", () => {
    const [op] = patternUpsertOps([{ routeId: "70-203", variants: [variant] }], SEEN_AT);
    if (op === undefined) throw new Error("expected one op");
    expect(op.q).toEqual({ _id: "70-203" });
    expect(op.u.$set).toEqual({
      variants: [variant],
      syncedAt: { $date: SEEN_AT.toISOString() },
    });
  });

  it("writes nothing for a route with no usable variant", () => {
    expect(patternUpsertOps([{ routeId: "70-203", variants: [] }], SEEN_AT)).toEqual([]);
  });
});
