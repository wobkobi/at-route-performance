// tests/lib/trip-board.test.ts
// Unit tests for placing cancelled trips on the route trip board, and the board view params.
import type { CancellationStage } from "@/lib/cancellation";
import type { CancelledTripRow } from "@/lib/data/cancelled";
import { buildTripBoardRows, sortRuns, tripBoardView, type TripBoardRow } from "@/lib/trip-board";
import type { PerTripStat } from "@/types/api";
import { describe, expect, it } from "vitest";

/**
 * A running trip starting at the given instant.
 * @param id - Trip id.
 * @param start - ISO scheduled start.
 * @param abs - Average absolute delay, seconds.
 * @returns The trip row.
 */
function run(id: string, start: string, abs = 60): PerTripStat {
  return {
    trip_id: id,
    vehicle_id: null,
    cars: null,
    scheduled_start: start,
    stops: 10,
    avg_delay_sec: abs,
    avg_abs_delay_sec: abs,
    worst_delay_sec: abs,
  };
}

/**
 * A cancelled trip starting at the given instant.
 * @param id - Trip id.
 * @param start - ISO scheduled start, or null when unknown.
 * @param stage - How the cancellation played out (defaults to never ran).
 * @returns The cancellation row.
 */
function cancel(
  id: string,
  start: string | null,
  stage: CancellationStage = "before",
): CancelledTripRow {
  return {
    trip_id: id,
    headsign: null,
    direction_id: null,
    scheduled_start: start,
    detected_at: start ?? "2026-09-13T18:00:00.000Z",
    stage,
  };
}

/**
 * Compact label per row: the trip id, prefixed "x" for a cancellation.
 * @param rows - Board rows.
 * @returns The labels in display order.
 */
function labels(rows: TripBoardRow[]): string[] {
  return rows.map((r) => (r.kind === "cancelled" ? `x${r.trip.trip_id}` : r.trip.trip_id));
}

const T7 = "2026-09-13T19:00:00.000Z"; // 7:00am NZST
const T8 = "2026-09-13T20:00:00.000Z";
const T9 = "2026-09-13T21:00:00.000Z";

describe("buildTripBoardRows", () => {
  it("puts cancellations below every run on the delay sorts, whatever the direction", () => {
    const runs = [run("a", T9, 300), run("b", T7, 100)];
    const cancelled = [cancel("c8", T8), cancel("c7", T7)];
    for (const sort of ["off", "late", "early"] as const) {
      for (const rev of [false, true]) {
        expect(labels(buildTripBoardRows(runs, cancelled, sort, rev))).toEqual([
          "a",
          "b",
          "xc7",
          "xc8",
        ]);
      }
    }
  });

  it("ranks only the runs, 1..n", () => {
    const rows = buildTripBoardRows(
      [run("a", T7), run("b", T9)],
      [cancel("c", T8)],
      "departure",
      false,
    );
    expect(rows.map((r) => (r.kind === "run" ? r.rank : null))).toEqual([1, null, 2]);
  });

  it("slots cancellations in by scheduled start on the departure sort", () => {
    const rows = buildTripBoardRows(
      [run("a", T7), run("b", T9)],
      [cancel("c9", T9), cancel("c8", T8)],
      "departure",
      false,
    );
    // Ties go to the cancellation, as it was due at the same time.
    expect(labels(rows)).toEqual(["a", "xc8", "xc9", "b"]);
  });

  it("follows a reversed departure sort", () => {
    const rows = buildTripBoardRows(
      [run("b", T9), run("a", T7)],
      [cancel("c8", T8), cancel("cEarly", "2026-09-13T18:00:00.000Z")],
      "departure",
      true,
    );
    expect(labels(rows)).toEqual(["b", "xc8", "a", "xcEarly"]);
  });

  it("puts a cancellation with no known start last", () => {
    const rows = buildTripBoardRows(
      [run("a", T9)],
      [cancel("u", null), cancel("c", T7)],
      "departure",
      false,
    );
    expect(labels(rows)).toEqual(["xc", "a", "xu"]);
  });

  it("lists cancellations alone when nothing ran", () => {
    expect(labels(buildTripBoardRows([], [cancel("c", T8)], "off", false))).toEqual(["xc"]);
  });

  it("folds a flagged trip that ran into its run instead of a second row", () => {
    const rows = buildTripBoardRows(
      [run("cut", T7), run("back", T8), run("fine", T9)],
      [cancel("cut", T7, "mid-trip"), cancel("back", T8, "ran")],
      "departure",
      false,
    );
    expect(labels(rows)).toEqual(["cut", "back", "fine"]);
    expect(rows.map((r) => (r.kind === "run" ? r.cancellation : "row"))).toEqual([
      "mid-trip",
      "ran",
      null,
    ]);
  });

  it("moves a run that never ran (only a leftover prediction) to the cancellations", () => {
    const rows = buildTripBoardRows(
      [run("ghostly", T7, 0), run("real", T9)],
      [cancel("ghostly", T7, "before")],
      "off",
      false,
    );
    expect(labels(rows)).toEqual(["real", "xghostly"]);
    expect(rows.map((r) => (r.kind === "run" ? r.rank : null))).toEqual([1, null]);
  });
});

describe("buildTripBoardRows with rider waits", () => {
  it("ranks a cancellation among the runs by its wait on the delay sorts", () => {
    const runs = [run("a", T7, 900), run("b", T8, 300), run("c", T9, 60)];
    const rows = buildTripBoardRows(runs, [cancel("x", T8)], "off", false, { x: 600 });
    expect(labels(rows)).toEqual(["a", "xx", "b", "c"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(rows[1]).toMatchObject({ kind: "cancelled", waitSec: 600 });
  });

  it("follows a reversed sort and puts a wait past every run first", () => {
    const runs = [run("c", T9, 60), run("b", T8, 300)];
    expect(labels(buildTripBoardRows(runs, [cancel("x", T8)], "off", true, { x: 120 }))).toEqual([
      "c",
      "xx",
      "b",
    ]);
    expect(
      labels(
        buildTripBoardRows([run("b", T8, 300)], [cancel("x", T8)], "late", false, { x: 3600 }),
      ),
    ).toEqual(["xx", "b"]);
  });

  it("leaves a cancellation with no known wait unranked below the runs", () => {
    const rows = buildTripBoardRows(
      [run("a", T7)],
      [cancel("x", T8), cancel("y", T9)],
      "off",
      false,
      { y: 30 },
    );
    expect(labels(rows)).toEqual(["a", "xy", "xx"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, undefined]);
  });
});

describe("sortRuns", () => {
  it("puts the largest first on off and late, the smallest on early, nulls last", () => {
    const runs = [
      run("mid", T7, 120),
      { ...run("none", T8), avg_abs_delay_sec: null, avg_delay_sec: null },
      run("big", T9, 600),
    ];
    expect(sortRuns(runs, "off", false).map((r) => r.trip_id)).toEqual(["big", "mid", "none"]);
    expect(sortRuns(runs, "early", false).map((r) => r.trip_id)).toEqual(["mid", "big", "none"]);
    expect(sortRuns(runs, "late", true).map((r) => r.trip_id)).toEqual(["mid", "big", "none"]);
  });

  it("breaks a tie the same way whatever order the runs arrive in", () => {
    const runs = [run("c", T9, 300), run("a", T7, 300), run("b", T8, 300)];
    expect(sortRuns(runs, "off", false).map((r) => r.trip_id)).toEqual(["a", "b", "c"]);
    expect(sortRuns([...runs].reverse(), "off", false).map((r) => r.trip_id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("tripBoardView", () => {
  it("keeps only the set board params", () => {
    expect(
      tripBoardView({
        d: "2026-09-20T01:00:00.000Z",
        dir: "1",
        thresholdSec: "",
        tsort: "late",
        trev: undefined,
        tpage: "2",
        mode: "BUS",
      }),
    ).toEqual({ dir: "1", tsort: "late", tpage: "2" });
  });

  it("skips a repeated param rather than guessing which value", () => {
    expect(tripBoardView({ tsort: ["late", "off"] })).toEqual({});
  });

  it("carries the part of the day, which narrows the board like the direction does", () => {
    expect(tripBoardView({ dir: "0", hours: "7-9" })).toEqual({ dir: "0", hours: "7-9" });
  });
});
