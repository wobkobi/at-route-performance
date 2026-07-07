// src/lib/at-alerts.test.ts
/**
 * @description Unit tests for the service-alert route filter in at-alerts.ts.
 */
import { alertsForRoute, type ServiceAlert } from "@/lib/at-alerts";
import { describe, expect, it } from "vitest";

/**
 * Build a minimal alert whose informed entities carry the given route ids.
 * @param id - Alert id.
 * @param routeIds - Feed route ids for the informed entities.
 * @returns A minimal {@link ServiceAlert}.
 */
function alert(id: string, routeIds: (string | undefined)[]): ServiceAlert {
  return {
    id,
    active_period: [],
    informed_entity: routeIds.map((route_id) => (route_id === undefined ? {} : { route_id })),
  };
}

describe("alertsForRoute", () => {
  const alerts = [
    alert("a1", ["NX1-202409"]),
    alert("a2", ["501-217", "502-217"]),
    alert("a3", [undefined]), // stop-only entity
    alert("a4", ["EAST-201"]),
  ];

  it("matches versioned feed route ids against version-stripped slugs", () => {
    expect(alertsForRoute(alerts, ["NX1"]).map((a) => a.id)).toEqual(["a1"]);
    expect(alertsForRoute(alerts, ["502"]).map((a) => a.id)).toEqual(["a2"]);
  });
  it("matches when the caller passes a full versioned id", () => {
    expect(alertsForRoute(alerts, ["EAST-201"]).map((a) => a.id)).toEqual(["a4"]);
  });
  it("returns nothing for unrelated routes or entities without a route id", () => {
    expect(alertsForRoute(alerts, ["WEST"])).toEqual([]);
  });
});
