// tests/lib/rider-wait.test.ts
// Unit tests for counting cancellations as the wait for the next trip.
import {
  applyPenalty,
  applyRoutePenalties,
  riderWaitPenalties,
  WAIT_CAP_SEC,
  withTripPenalty,
  type DayFlag,
  type DayRun,
  type PunctualityFields,
} from "@/lib/rider-wait";
import { describe, expect, it } from "vitest";

const T0 = Date.parse("2026-09-14T20:00:00Z");
const MIN = 60_000;

/**
 * A run of route "R" in direction 0.
 * @param id - Trip id.
 * @param min - Start, minutes after the base.
 * @param stops - Stops served.
 * @param extra - Fields to override.
 * @returns The run.
 */
function run(id: string, min: number, stops = 20, extra: Partial<DayRun> = {}): DayRun {
  return { tripId: id, route: "R", direction: 0, start: T0 + min * MIN, stops, ...extra };
}

/**
 * A flagged trip of route "R" in direction 0.
 * @param id - Trip id.
 * @param min - Start, minutes after the base.
 * @param stage - How the cancellation played out.
 * @param extra - Fields to override.
 * @returns The flag.
 */
function flag(
  id: string,
  min: number,
  stage: DayFlag["stage"] = "before",
  extra: Partial<DayFlag> = {},
): DayFlag {
  return { tripId: id, route: "R", direction: 0, start: T0 + min * MIN, stage, ...extra };
}

describe("riderWaitPenalties", () => {
  const runs = [run("a", 0), run("b", 10), run("c", 20), run("back", 30, 20, { direction: 1 })];

  it("charges a trip that never ran every stop at the wait for the next run", () => {
    const { routes, trips } = riderWaitPenalties(runs, [flag("x", 5)]);
    expect(trips.x).toEqual({ waitSec: 300, events: 20 });
    expect(routes.R).toEqual({ events: 20, delaySec: 6000, lateEvents: 0 });
  });

  it("counts a wait past the late bound as late", () => {
    const { routes } = riderWaitPenalties([run("a", 0), run("b", 30)], [flag("x", 1)]);
    expect(routes.R?.lateEvents).toBe(20);
  });

  it("charges a trip cut short only the stops after the cut", () => {
    const { trips } = riderWaitPenalties(
      [...runs, run("cut", 12, 8)],
      [flag("cut", 12, "mid-trip")],
    );
    expect(trips.cut).toEqual({ waitSec: 480, events: 12 });
  });

  it("charges a reinstated trip nothing and skips a flag with no start", () => {
    const { routes } = riderWaitPenalties(runs, [
      flag("r", 5, "ran"),
      flag("n", 0, "before", { start: null }),
    ]);
    expect(routes).toEqual({});
  });

  it("never takes another cancelled trip as the next trip", () => {
    const leftover = run("gone", 7, 1);
    const { trips } = riderWaitPenalties([...runs, leftover], [flag("x", 5), flag("gone", 7)]);
    expect(trips.x).toEqual({ waitSec: 300, events: 20 });
  });

  it("waits the cap when nothing runs after", () => {
    const { trips } = riderWaitPenalties(runs, [flag("late", 25)]);
    expect(trips.late?.waitSec).toBe(WAIT_CAP_SEC);
  });

  it("looks at any direction when the flag's is unknown", () => {
    const { trips } = riderWaitPenalties(runs, [flag("x", 25, "before", { direction: null })]);
    expect(trips.x?.waitSec).toBe(300);
  });
});

describe("applyPenalty", () => {
  const row = {
    events: 80,
    avg_delay_sec: 60,
    avg_abs_delay_sec: 120,
    on_time_pct: 75,
    early_pct: 5,
    late_pct: 20,
  };

  it("folds the waits into the averages and shares by event weight", () => {
    const out = applyPenalty(row, { events: 20, delaySec: 20 * 900, lateEvents: 20 });
    expect(out).toEqual({
      events: 100,
      avg_delay_sec: 228,
      avg_abs_delay_sec: 276,
      on_time_pct: 60,
      early_pct: 4,
      late_pct: 36,
    });
  });

  it("leaves a row without a penalty untouched", () => {
    expect(applyPenalty(row, undefined)).toBe(row);
  });

  it("gives a cancellation-only route figures from its penalty alone", () => {
    const empty = { events: 0, avg_delay_sec: null, avg_abs_delay_sec: null, on_time_pct: null };
    expect(applyPenalty(empty, { events: 10, delaySec: 3000, lateEvents: 0 })).toMatchObject({
      events: 10,
      avg_abs_delay_sec: 300,
      on_time_pct: 100,
    });
  });
});

describe("applyRoutePenalties", () => {
  /**
   * A ranking row.
   * @param routeId - Versioned route id.
   * @returns The row.
   */
  const row = (routeId: string): PunctualityFields & { route_id: string } => ({
    route_id: routeId,
    events: 100,
    avg_delay_sec: 0,
    avg_abs_delay_sec: 0,
    on_time_pct: 100,
  });

  it("matches penalties to rows by slug and folds a retired line into its successor", () => {
    const out = applyRoutePenalties([row("NX1-203"), row("E-W-201"), row("70-203")], {
      NX1: { events: 100, delaySec: 100 * 600, lateEvents: 100 },
      WEST: { events: 100, delaySec: 100 * 600, lateEvents: 100 },
    });
    expect(out.map((r) => r.on_time_pct)).toEqual([50, 50, 100]);
  });
});

describe("withTripPenalty", () => {
  it("averages the unserved stops in at the wait and raises the worst delay", () => {
    const run = { stops: 10, avg_delay_sec: 60, avg_abs_delay_sec: 90, worst_delay_sec: 200 };
    expect(withTripPenalty(run, { waitSec: 600, events: 10 })).toEqual({
      stops: 10,
      avg_delay_sec: 330,
      avg_abs_delay_sec: 345,
      worst_delay_sec: 600,
    });
    expect(withTripPenalty(run, undefined)).toBe(run);
  });
});
