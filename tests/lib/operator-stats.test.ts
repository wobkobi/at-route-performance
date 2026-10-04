// tests/lib/operator-stats.test.ts
import type { Mode } from "@/lib/mode";
import { operatorRows, vehicleOperatorCodes } from "@/lib/operator-stats";
import type { VehicleTotal } from "@/lib/vehicle/rank";
import type { RouteRow } from "@/types/api";
import { describe, expect, it } from "vitest";

const OPS = { "70": "HE", "72C": "HE", NX1: "TZG", "S-C": "AM" };

/**
 * A route row with the figures under test.
 * @param routeId - Route id.
 * @param events - Arrivals.
 * @param on_time_pct - On-time share.
 * @param mode - Mode.
 * @returns The row.
 */
function row(
  routeId: string,
  events: number,
  on_time_pct: number | null,
  mode: Mode = "BUS",
): RouteRow {
  return {
    routeId,
    shortName: routeId,
    longName: routeId,
    mode,
    events,
    avg_delay_sec: 60,
    avg_abs_delay_sec: 90,
    on_time_pct,
    early_pct: 5,
    late_pct: 10,
  };
}

/**
 * A vehicle total that ran the given routes.
 * @param vehicleId - Vehicle id.
 * @param routes - Route ids it ran.
 * @returns The total.
 */
function vehicle(vehicleId: string, routes: string[]): VehicleTotal {
  return {
    vehicleId,
    mode: "BUS",
    runs: 1,
    serviceSec: 1,
    arrivals: 1,
    avgOffSec: 1,
    routes,
    days: 1,
  };
}

describe("operatorRows", () => {
  it("weights each route's share by its arrivals and counts routes by slug", () => {
    const [he] = operatorRows(
      [row("70-202", 300, 90), row("70-203", 100, 50), row("72C-202", 600, 70)],
      OPS,
    );
    expect(he!.operator.code).toBe("HE");
    expect(he!.routes).toBe(2);
    expect(he!.events).toBe(1000);
    // (300*90 + 100*50 + 600*70) / 1000
    expect(he!.on_time_pct).toBe(74);
  });

  it("skips a null share rather than counting it as zero", () => {
    const [he] = operatorRows([row("70-202", 200, 80), row("72C-202", 200, null)], OPS);
    expect(he!.on_time_pct).toBe(80);
  });

  it("sorts operators under the board minimum after the rest", () => {
    const out = operatorRows([row("70-202", 500, 60), row("NX1-207", 50, 99)], OPS);
    expect(out.map((o) => o.operator.code)).toEqual(["HE", "TZG"]);
  });

  it("drops routes with no operator recorded", () => {
    expect(operatorRows([row("999-1", 500, 60)], OPS)).toEqual([]);
  });

  it("adds cancellations, including a route with no arrivals", () => {
    const [he] = operatorRows([row("70-202", 500, 60)], OPS, new Map([["72C", 4]]));
    expect(he!.cancelled).toBe(4);
    expect(he!.routes).toBe(2);
  });

  it("counts the fleet only when vehicles are given, and lists modes in order", () => {
    const rows = [row("S-C-201", 500, 90, "TRAIN"), row("70-202", 500, 60)];
    expect(operatorRows(rows, OPS)[0]!.vehicles).toBeNull();
    const out = operatorRows(rows, OPS, new Map(), [
      vehicle("1", ["70-202"]),
      vehicle("2", ["S-C-201"]),
    ]);
    expect(out.find((o) => o.operator.code === "HE")!.vehicles).toBe(1);
    expect(out.find((o) => o.operator.code === "AM")!.modes).toEqual(["TRAIN"]);
  });
});

describe("vehicleOperatorCodes", () => {
  it("names each operator once, across feed versions", () => {
    expect(vehicleOperatorCodes(vehicle("1", ["70-202", "72C-203", "NX1-207"]), OPS)).toEqual([
      "HE",
      "TZG",
    ]);
  });
});
