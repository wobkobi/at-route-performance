// src/lib/at-alerts.test.ts
/**
 * @description Unit tests for the service-alert filters and severity grading in at-alerts.ts.
 */
import {
  alertSeverity,
  alertsForRoute,
  alertsForStop,
  hasSevereAlert,
  type ServiceAlert,
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
