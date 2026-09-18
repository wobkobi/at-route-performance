// src/lib/at-alerts.test.ts
// Unit tests for the service-alert filters and severity grading in at-alerts.ts.

import {
  alertSeverity,
  alertsForRoute,
  alertsForStop,
  alertsForTrip,
  extractText,
  hasSevereAlert,
  networkWideAlerts,
  resolveAlertRoutes,
  routeIdsInText,
  type ServiceAlert,
  toServiceAlerts,
} from "@/lib/at-alerts";
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

/**
 * Build a minimal alert whose informed entities carry the given stop ids.
 * @param id - Alert id.
 * @param stopIds - Raw GTFS stop ids for the informed entities.
 * @returns A minimal {@link ServiceAlert}.
 */
function stopAlert(id: string, stopIds: string[]): ServiceAlert {
  return {
    id,
    active_period: [],
    informed_entity: stopIds.map((stop_id) => ({ stop_id })),
  };
}

describe("alertsForStop", () => {
  const alerts = [
    stopAlert("s1", ["9312-e5a780ea"]),
    stopAlert("s2", ["1534-a48bd69a"]),
    alert("s3", ["NX1-202409"]),
  ];

  it("matches a plain stop by its own id", () => {
    expect(alertsForStop(alerts, ["1534-a48bd69a"]).map((a) => a.id)).toEqual(["s2"]);
  });

  it("matches a station through any of its platform ids", () => {
    // The feed only ever names a raw platform, so a station has to be expanded
    // to its members - matching its own "station:" id found nothing at all.
    expect(alertsForStop(alerts, ["9312-e5a780ea", "9313-4b1bb1e7"]).map((a) => a.id)).toEqual([
      "s1",
    ]);
  });

  it("ignores route-only alerts and unknown stops", () => {
    expect(alertsForStop(alerts, ["station:105-474861ff"])).toEqual([]);
    expect(alertsForStop(alerts, [])).toEqual([]);
  });
});

/**
 * Build a minimal alert with the given GTFS-RT effect.
 * @param id - Alert id.
 * @param effect - GTFS-RT `effect` value, or undefined to omit it.
 * @returns A minimal {@link ServiceAlert}.
 */
function effectAlert(id: string, effect?: string): ServiceAlert {
  return { id, active_period: [], informed_entity: [], effect };
}

describe("alertSeverity", () => {
  it("grades service-stopping effects as severe", () => {
    expect(alertSeverity(effectAlert("a", "NO_SERVICE"))).toBe("severe");
    expect(alertSeverity(effectAlert("b", "SIGNIFICANT_DELAYS"))).toBe("severe");
    expect(alertSeverity(effectAlert("c", "DETOUR"))).toBe("severe");
  });

  it("grades routine notices as info, so they cannot read as an emergency", () => {
    expect(alertSeverity(effectAlert("d", "OTHER_EFFECT"))).toBe("info");
    expect(alertSeverity(effectAlert("e", "MODIFIED_SERVICE"))).toBe("info");
    expect(alertSeverity(effectAlert("f"))).toBe("info");
  });
});

/**
 * Build a single-trip cancellation the way AT sends one: a trip entity alone,
 * headed with the route's versioned id.
 * @param id - Alert id.
 * @param tripId - The cancelled trip.
 * @param header - The header text.
 * @returns A minimal {@link ServiceAlert}.
 */
function tripAlert(
  id: string,
  tripId: string,
  header = "Service Cancellation for Route 195-203",
): ServiceAlert {
  return {
    id,
    active_period: [],
    informed_entity: [{ trip_id: tripId }],
    effect: "NO_SERVICE",
    header_text: { translation: [{ text: header, language: "en" }] },
    description_text: { translation: [{ text: "Trip Cancelled", language: "en" }] },
  };
}

describe("toServiceAlerts", () => {
  it("keeps the trip a trip-level entity names", () => {
    const feed = toServiceAlerts({
      entity: [{ id: "c1", alert: { informed_entity: [{ trip: { trip_id: "1195-20310" } }] } }],
    });
    expect(feed.alerts[0]?.informed_entity).toEqual([
      {
        agency_id: undefined,
        route_id: undefined,
        route_type: undefined,
        stop_id: undefined,
        trip_id: "1195-20310",
      },
    ]);
  });
});

describe("routeIdsInText", () => {
  it("finds the versioned id form and leaves the prose form alone", () => {
    expect(routeIdsInText(tripAlert("c1", "t1"))).toEqual(["195-203"]);
    expect(routeIdsInText(tripAlert("d1", "t1", "Detour: Route 781 - Cenotaph Road"))).toEqual([]);
  });
});

describe("resolveAlertRoutes", () => {
  const shortNames = new Map([
    ["195-203", "195"],
    ["MTID-241", "MTIA"],
  ]);

  it("routes a trip entity through the trip's metadata and names the route by its short name", () => {
    const resolved = resolveAlertRoutes(
      tripAlert("c1", "t1", "Service Cancellation for Route MTID-241"),
      new Map([["t1", "MTID-241"]]),
      shortNames,
    );
    expect(resolved.informed_entity).toEqual([{ trip_id: "t1", route_id: "MTID-241" }]);
    expect(extractText(resolved.header_text)).toBe("Service Cancellation for Route MTIA");
    expect(extractText(resolved.description_text)).toBe("Trip Cancelled");
  });

  it("falls back to the route the header names for a trip the metadata has not seen", () => {
    const resolved = resolveAlertRoutes(tripAlert("c1", "unseen"), new Map(), shortNames);
    expect(resolved.informed_entity).toEqual([{ trip_id: "unseen", route_id: "195-203" }]);
    expect(extractText(resolved.header_text)).toBe("Service Cancellation for Route 195");
  });

  it("leaves a trip unrouted, and its text as sent, when nothing names a known route", () => {
    const resolved = resolveAlertRoutes(
      tripAlert("c1", "unseen", "Service Cancellation for Route 999-1"),
      new Map(),
      shortNames,
    );
    expect(resolved.informed_entity).toEqual([{ trip_id: "unseen" }]);
    expect(extractText(resolved.header_text)).toBe("Service Cancellation for Route 999-1");
  });

  it("does not re-route an entity that already names its route", () => {
    const a = alert("r1", ["NX1-202409"]);
    expect(resolveAlertRoutes(a, new Map(), shortNames).informed_entity).toEqual([
      { route_id: "NX1-202409" },
    ]);
  });
});

describe("networkWideAlerts", () => {
  it("keeps a trip-level alert off the network banner, routed or not", () => {
    const unrouted = tripAlert("c1", "t1");
    const routed = resolveAlertRoutes(unrouted, new Map([["t1", "195-203"]]), new Map());
    const agency: ServiceAlert = {
      id: "n1",
      active_period: [],
      informed_entity: [{ agency_id: "AT" }],
    };
    expect(networkWideAlerts([unrouted, routed, agency]).map((a) => a.id)).toEqual(["n1"]);
  });
});

describe("alertsForTrip", () => {
  const routeWide = alert("r1", ["195-203"]);
  const thisRun = {
    ...tripAlert("c1", "t1"),
    informed_entity: [{ trip_id: "t1", route_id: "195-203" }],
  };
  const otherRun = {
    ...tripAlert("c2", "t2"),
    informed_entity: [{ trip_id: "t2", route_id: "195-203" }],
  };

  it("takes the route's own alerts and the trip's, but not another run's", () => {
    expect(alertsForTrip([routeWide, thisRun, otherRun], "195-203", "t1").map((a) => a.id)).toEqual(
      ["r1", "c1"],
    );
  });

  it("finds a cancelled run's alert on its route page", () => {
    expect(alertsForRoute([thisRun, otherRun], ["195"]).map((a) => a.id)).toEqual(["c1", "c2"]);
  });
});

describe("hasSevereAlert", () => {
  it("is true when any alert in the set is severe", () => {
    expect(hasSevereAlert([effectAlert("a", "OTHER_EFFECT"), effectAlert("b", "NO_SERVICE")])).toBe(
      true,
    );
  });

  it("is false for an all-notice set, and for an empty one", () => {
    expect(hasSevereAlert([effectAlert("a", "OTHER_EFFECT")])).toBe(false);
    expect(hasSevereAlert([])).toBe(false);
  });
});
