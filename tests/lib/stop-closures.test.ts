// tests/lib/stop-closures.test.ts
import type { AtTripUpdates } from "@/lib/at";
import type { ServiceAlert } from "@/lib/at-alerts";
import {
  alertStints,
  excursions,
  feedMarks,
  reconcileClosures,
  type AlertStint,
  type Closure,
  type ClosureInput,
  type RunTrace,
  type StopMark,
} from "@/lib/stop-closures";
import { describe, expect, it } from "vitest";

/** 22 Sep 2026, 12:00 NZST. */
const T0 = Date.parse("2026-09-22T00:00:00Z");

/**
 * An instant some minutes after {@link T0}.
 * @param min - Minutes, negative for before.
 * @returns The instant.
 */
function at(min: number): Date {
  return new Date(T0 + min * 60_000);
}

/**
 * A run that left its road between B and E: timed at A and B, read off route
 * twice, then timed at E, F and G.
 * @param tripId - The trip.
 * @param start - Minutes past {@link T0} it was timed at A.
 * @param directionId - Its direction.
 * @returns The run.
 */
function detourRun(tripId: string, start: number, directionId = 0): RunTrace {
  return {
    tripId,
    routeId: "64-202",
    directionId,
    arrivals: [
      { stopId: "A", at: at(start), vehicle: true },
      { stopId: "B", at: at(start + 2), vehicle: true },
      { stopId: "E", at: at(start + 9), vehicle: true },
      { stopId: "F", at: at(start + 11), vehicle: true },
      { stopId: "G", at: at(start + 13), vehicle: true },
    ],
    readings: [
      { at: at(start + 4), alert: null },
      { at: at(start + 6), alert: null },
    ],
  };
}

/**
 * A run that drove the whole road on route, timed at A to G two minutes apart.
 * @param tripId - The trip.
 * @param start - Minutes past {@link T0} it was timed at A.
 * @param directionId - Its direction.
 * @returns The run.
 */
function onRouteRun(tripId: string, start: number, directionId = 0): RunTrace {
  return {
    tripId,
    routeId: "64-202",
    directionId,
    arrivals: ["A", "B", "C", "D", "E", "F", "G"].map((stopId, i) => ({
      stopId,
      at: at(start + i * 2),
      vehicle: true,
    })),
    readings: [],
  };
}

/**
 * A stored row.
 * @param fields - The row's kind, source, start and anything else it holds.
 * @returns The row.
 */
function row(fields: Pick<Closure, "kind" | "source" | "from"> & Partial<Closure>): Closure {
  return {
    id: "r1",
    routeId: "64-202",
    directionId: null,
    stopIds: [],
    fromStopId: null,
    toStopId: null,
    alertId: null,
    effect: null,
    alert: null,
    runs: [],
    clears: [],
    confirmedAt: null,
    disputedAt: null,
    to: null,
    ...fields,
  };
}

/**
 * One poll's input: two hours past {@link T0}, no evidence, and the alerts feed
 * failed, so alert rows stay as they are unless a test gives alerts.
 * @param fields - What the test sets.
 * @returns The input.
 */
function poll(fields: Partial<ClosureInput>): ClosureInput {
  return { now: at(120), rows: [], alerts: null, skipped: [], served: [], runs: [], ...fields };
}

/** A confirmed detour between B and E one way, from three runs. */
const confirmed = row({
  kind: "detour",
  source: "seen",
  directionId: 0,
  fromStopId: "B",
  toStopId: "E",
  from: at(4),
  runs: [
    { tripId: "t1", at: at(4) },
    { tripId: "t2", at: at(24) },
    { tripId: "t3", at: at(44) },
  ],
  confirmedAt: at(44),
});

describe("alertStints", () => {
  const now = at(0);
  /**
   * An instant as the alerts feed writes it.
   * @param min - Minutes past {@link T0}.
   * @returns Epoch seconds.
   */
  const sec = (min: number): number => at(min).getTime() / 1000;

  it("takes the period in force, and groups the stops an alert names by route", () => {
    const alert: ServiceAlert = {
      id: "a1",
      effect: "STOP_MOVED",
      active_period: [
        { start: sec(-1500), end: sec(-1400) },
        { start: sec(-60), end: sec(240) },
      ],
      informed_entity: [
        { route_id: "22R-202", stop_id: "S1" },
        { route_id: "149-202", stop_id: "S1" },
        { route_id: "22R-202", stop_id: "S2" },
        { trip_id: "t9" },
      ],
      header_text: {
        translation: [
          { language: "en", text: "Stop Skipped: Rosebank Road [Schedule Start: 22-09-2026]" },
        ],
      },
    };
    expect(alertStints([alert], now)).toEqual([
      {
        alertId: "a1",
        routeId: "22R-202",
        stopIds: ["S1", "S2"],
        effect: "STOP_MOVED",
        header: "Stop Skipped: Rosebank Road",
        start: at(-60),
      },
      {
        alertId: "a1",
        routeId: "149-202",
        stopIds: ["S1"],
        effect: "STOP_MOVED",
        header: "Stop Skipped: Rosebank Road",
        start: at(-60),
      },
    ]);
  });

  it("keeps a detour naming a route and no stops, and leaves out the rest", () => {
    const base = { active_period: [] };
    const alerts: ServiceAlert[] = [
      { ...base, id: "d", effect: "DETOUR", informed_entity: [{ route_id: "195-203" }] },
      { ...base, id: "n", effect: "NO_SERVICE", informed_entity: [{ route_id: "195-203" }] },
      { ...base, id: "r", effect: "REDUCED_SERVICE", informed_entity: [{ stop_id: "S1" }] },
      {
        ...base,
        id: "f",
        effect: "NO_SERVICE",
        active_period: [{ start: sec(60), end: sec(120) }],
        informed_entity: [{ stop_id: "S1" }],
      },
    ];
    expect(alertStints(alerts, now)).toEqual([
      { alertId: "d", routeId: "195-203", stopIds: [], effect: "DETOUR", header: null, start: now },
    ]);
  });
});

describe("feedMarks", () => {
  const now = at(0);
  const feed: AtTripUpdates = {
    entity: [
      {
        id: "1",
        trip_update: {
          trip: {
            trip_id: "t1",
            route_id: "E-W-201",
            start_date: "20260922",
            start_time: "11:30:00",
            direction_id: 1,
          },
          stop_time_update: [
            { stop_id: "S1", schedule_relationship: 1 },
            { stop_id: "S2", arrival: { time: now.getTime() / 1000 - 60 } },
            { stop_id: "S3", arrival: { time: now.getTime() / 1000 + 300 } },
          ],
        },
      },
      {
        id: "2",
        trip_update: {
          trip: {
            trip_id: "t2",
            route_id: "E-W-201",
            start_date: "20260922",
            start_time: "22:33:00",
            direction_id: 0,
          },
          stop_time_update: { stop_id: "S1", schedule_relationship: 1 },
        },
      },
      {
        id: "3",
        trip_update: {
          trip: { trip_id: "t3", route_id: "E-W-201", start_time: "11:00:00" },
          stop_time_update: [{ stop_id: "S1", schedule_relationship: 1 }],
        },
      },
    ],
  };

  it("counts a skip once its run has started, and a timed stop once its time has passed", () => {
    const { skipped, served } = feedMarks(feed, now);
    expect(skipped).toEqual([
      { routeId: "E-W-201", directionId: 1, stopId: "S1", tripId: "t1", at: now },
    ]);
    expect(served).toEqual([
      { routeId: "E-W-201", directionId: 1, stopId: "S2", tripId: "t1", at: at(-1) },
    ]);
  });
});

describe("excursions", () => {
  it("places a detour between the last stop timed before it and the first after", () => {
    expect(excursions(detourRun("t1", 0))).toEqual([
      { fromStopId: "B", toStopId: "E", at: at(4), alert: null },
    ]);
  });

  it("ignores a lone reading, and readings after the run's last stops", () => {
    const run = onRouteRun("t1", 0);
    run.readings = [
      { at: at(5), alert: null },
      ...[13, 15, 17].map((m) => ({ at: at(m), alert: null })),
    ];
    expect(excursions(run)).toEqual([]);
  });

  it("splits readings an arrival separates into two stretches", () => {
    const run = onRouteRun("t1", 0);
    run.readings = [3, 3.5, 7, 7.5].map((m) => ({ at: at(m), alert: m > 5 ? "Detour" : null }));
    expect(excursions(run)).toEqual([
      { fromStopId: "B", toStopId: "C", at: at(3), alert: null },
      { fromStopId: "D", toStopId: "E", at: at(7), alert: "Detour" },
    ]);
  });
});

describe("reconcileClosures: detours the runs show", () => {
  it("opens an unannounced detour as suspected on its first run", () => {
    const [made, ...rest] = reconcileClosures(poll({ runs: [detourRun("t1", 0)] }));
    expect(rest).toEqual([]);
    expect(made).toMatchObject({
      id: null,
      kind: "detour",
      source: "seen",
      routeId: "64-202",
      directionId: 0,
      fromStopId: "B",
      toStopId: "E",
      alert: null,
      from: at(4),
      confirmedAt: null,
      to: null,
    });
  });

  it("confirms it at the third separate run within two hours", () => {
    const first = row({ ...confirmed, runs: confirmed.runs.slice(0, 1), confirmedAt: null });
    const changed = reconcileClosures(
      poll({ rows: [first], runs: [0, 20, 40].map((m, i) => detourRun(`t${i + 1}`, m)) }),
    );
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ id: "r1", confirmedAt: at(44), to: null });
    expect(changed[0]!.runs.map((r) => r.tripId)).toEqual(["t1", "t2", "t3"]);
  });

  it("clears once the last three runs drive the stretch on route, from the first of them", () => {
    const two = reconcileClosures(
      poll({ rows: [confirmed], runs: [onRouteRun("t4", 60), onRouteRun("t5", 70)] }),
    );
    expect(two[0]).toMatchObject({ to: null });
    expect(two[0]!.clears).toHaveLength(2);

    const three = reconcileClosures(
      poll({
        rows: [two[0]!],
        runs: [onRouteRun("t4", 60), onRouteRun("t5", 70), onRouteRun("t6", 80)],
      }),
    );
    expect(three[0]).toMatchObject({ to: at(62) });
  });

  it("starts the count over when a run detours again", () => {
    const cleared = row({
      ...confirmed,
      clears: [
        { tripId: "t4", at: at(62) },
        { tripId: "t5", at: at(72) },
      ],
    });
    const [again] = reconcileClosures(poll({ rows: [cleared], runs: [detourRun("t6", 80)] }));
    expect(again).toMatchObject({ to: null, clears: [] });
    expect(again!.runs).toHaveLength(4);
  });

  it("records a one-way bypass one way only", () => {
    const changed = reconcileClosures(
      poll({
        runs: [
          ...[0, 20, 40].map((m, i) => detourRun(`t${i + 1}`, m, 0)),
          ...[60, 70, 80].map((m, i) => onRouteRun(`u${i + 1}`, m, 1)),
        ],
      }),
    );
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ directionId: 0, confirmedAt: at(44), to: null, clears: [] });
  });

  it("lets a suspected detour lapse two hours after its only run", () => {
    const suspected = row({ ...confirmed, runs: confirmed.runs.slice(0, 1), confirmedAt: null });
    expect(reconcileClosures(poll({ now: at(123), rows: [suspected] }))).toEqual([]);
    const [lapsed] = reconcileClosures(poll({ now: at(125), rows: [suspected] }));
    expect(lapsed).toMatchObject({ to: at(4) });
  });

  it("never reopens a detour for a run the ended row already counted", () => {
    const ended = row({ ...confirmed, to: at(62) });
    expect(reconcileClosures(poll({ rows: [ended], runs: [detourRun("t3", 40)] }))).toEqual([]);
  });

  it("returns nothing when the poll changes nothing", () => {
    expect(reconcileClosures(poll({ rows: [confirmed], runs: [detourRun("t3", 40)] }))).toEqual([]);
  });
});

describe("reconcileClosures: stops AT skips", () => {
  /**
   * A run's stop time at the one stop, skipped or timed.
   * @param tripId - The run.
   * @param min - Minutes past {@link T0}.
   * @param directionId - Its direction.
   * @returns The mark.
   */
  const skip = (tripId: string, min: number, directionId = 1): StopMark => ({
    routeId: "E-W-201",
    directionId,
    stopId: "9296",
    tripId,
    at: at(min),
  });

  it("confirms a skip on the third run one way, and ends it once three runs are timed there", () => {
    const [made] = reconcileClosures(
      poll({ now: at(31), skipped: [skip("t1", 0), skip("t2", 15), skip("t3", 30)] }),
    );
    expect(made).toMatchObject({
      kind: "closed",
      source: "skipped",
      directionId: 1,
      stopIds: ["9296"],
      from: at(0),
      confirmedAt: at(30),
      to: null,
    });

    const stored = { ...made!, id: "r1" };
    const [open] = reconcileClosures(
      poll({
        now: at(61),
        rows: [stored],
        served: [skip("t4", 40), skip("t5", 50), skip("w", 55, 0)],
      }),
    );
    expect(open).toMatchObject({ to: null });
    const [ended] = reconcileClosures(
      poll({
        now: at(61),
        rows: [open!],
        served: [skip("t4", 40), skip("t5", 50), skip("t6", 60)],
      }),
    );
    expect(ended).toMatchObject({ to: at(40) });
  });
});

describe("reconcileClosures: alerts", () => {
  const stint: AlertStint = {
    alertId: "a1",
    routeId: "22R-202",
    stopIds: ["S1"],
    effect: "STOP_MOVED",
    header: "Stop Skipped: Rosebank Road",
    start: at(-30),
  };

  it("opens a row from the stint's start, ends it when the alert goes, and waits out a failed feed", () => {
    const [made] = reconcileClosures(poll({ now: at(0), alerts: [stint] }));
    expect(made).toMatchObject({
      kind: "closed",
      source: "alert",
      routeId: "22R-202",
      directionId: null,
      stopIds: ["S1"],
      alert: "Stop Skipped: Rosebank Road",
      from: at(-30),
      to: null,
    });
    const stored = { ...made!, id: "r1" };
    expect(reconcileClosures(poll({ now: at(2), rows: [stored], alerts: null }))).toEqual([]);
    expect(reconcileClosures(poll({ now: at(2), rows: [stored], alerts: [stint] }))).toEqual([]);
    const [ended] = reconcileClosures(poll({ now: at(4), rows: [stored], alerts: [] }));
    expect(ended).toMatchObject({ id: "r1", to: at(4) });

    const [back] = reconcileClosures(poll({ now: at(6), rows: [ended!], alerts: [stint] }));
    expect(back).toMatchObject({ id: "r1", to: null });
  });

  it("keeps an announced detour open but disputes it after three runs on route at its stops", () => {
    const announced = row({
      kind: "detour",
      source: "alert",
      alertId: "a2",
      effect: "DETOUR",
      stopIds: ["C", "D"],
      from: at(0),
    });
    const near = onRouteRun("n1", 40);
    near.readings = [{ at: at(45), alert: null }];
    const [two] = reconcileClosures(
      poll({ rows: [announced], runs: [onRouteRun("t1", 10), onRouteRun("t2", 20), near] }),
    );
    expect(two).toMatchObject({ disputedAt: null, to: null });
    expect(two!.clears).toHaveLength(2);

    const [three] = reconcileClosures(poll({ rows: [two!], runs: [onRouteRun("t3", 30)] }));
    expect(three).toMatchObject({ disputedAt: at(34), to: null });

    const [upheld] = reconcileClosures(poll({ rows: [three!], runs: [detourRun("t4", 60)] }));
    expect(upheld).toMatchObject({ disputedAt: null, clears: [] });
  });
});
