// tests/lib/trip-line.test.ts
import type { ScheduledStop } from "@/lib/data/trips";
import { buildTripLine, type TripLineInput } from "@/lib/trip-line";
import type { TripStop } from "@/types/api";
import { describe, expect, it } from "vitest";

/**
 * A timetabled stop.
 * @param id - Stop id, also its name.
 * @param seq - Stop sequence.
 * @returns The stop.
 */
function sched(id: string, seq: number): ScheduledStop {
  return { stop_id: id, name: id, lat: 0, lon: 0, stop_sequence: seq, departure_time: "08:00:00" };
}

/**
 * A recorded arrival.
 * @param id - Stop id, also its name.
 * @param minute - Minutes past 8:00 it was scheduled at.
 * @returns The arrival.
 */
function rec(id: string, minute: number): TripStop {
  const scheduledAt = new Date(at(minute)).toISOString();
  return { stop_id: id, name: id, lat: 0, lon: 0, scheduled_at: scheduledAt, deviation_sec: 30 };
}

/**
 * An instant on the test run's morning.
 * @param minute - Minutes past 8:00 NZ.
 * @returns Epoch ms.
 */
function at(minute: number): number {
  return Date.UTC(2026, 8, 21, 20, minute);
}

const FIVE = ["A", "B", "C", "D", "E"].map((id, i) => sched(id, i + 1));

/**
 * Build with defaults for the fields a case does not set.
 * @param over - The fields to set.
 * @returns The line.
 */
function line(over: Partial<TripLineInput>): ReturnType<typeof buildTripLine> {
  return buildTripLine({
    scheduled: FIVE,
    recorded: [],
    stage: null,
    offRoute: [],
    live: false,
    ...over,
  });
}

describe("buildTripLine", () => {
  it("draws a plain run as one straight line of legs", () => {
    const l = line({ recorded: FIVE.map((s, i) => rec(s.stop_id, i * 5)) });
    expect(l.stops.map((s) => s.state)).toEqual(Array(5).fill("recorded"));
    expect(l.legs.map((g) => [g.from, g.to, g.kind])).toEqual([
      [0, 1, "run"],
      [1, 2, "run"],
      [2, 3, "run"],
      [3, 4, "run"],
    ]);
    expect(l.bypasses).toEqual([]);
  });

  it("puts a stop off the timetable where it came in time, not at the end", () => {
    const l = line({
      recorded: [rec("A", 0), rec("B", 5), rec("X", 7), rec("C", 10), rec("E", 20)],
    });
    expect(l.stops.map((s) => s.stop_id)).toEqual(["A", "B", "X", "C", "D", "E"]);
    expect(l.stops[2]).toMatchObject({ offTimetable: true, state: "recorded" });
  });

  it("calls a gap skipped only on a run that left its road path", () => {
    const recorded = [rec("A", 0), rec("X", 6), rec("Y", 8), rec("D", 15), rec("E", 20)];
    const plain = line({ recorded });
    expect(plain.stops.filter((s) => s.state === "unrecorded").map((s) => s.stop_id)).toEqual([
      "B",
      "C",
    ]);

    const detoured = line({ recorded, offRoute: [at(7), at(10)] });
    expect(detoured.stops.map((s) => `${s.stop_id}:${s.state}`)).toEqual([
      "A:recorded",
      "X:recorded",
      "Y:recorded",
      "B:skipped",
      "C:skipped",
      "D:recorded",
      "E:recorded",
    ]);
    // The path goes A > X > Y > D, around B and C; the trunk A..D is the bypass.
    expect(detoured.legs.map((g) => [g.from, g.to])).toEqual([
      [0, 1],
      [1, 2],
      [2, 5],
      [5, 6],
    ]);
    expect(detoured.bypasses).toEqual([{ from: 0, to: 5 }]);
  });

  it("leaves a gap alone when no off-route reading falls inside it", () => {
    // Off route at 8:16 and 8:18, after D was reached: the B-C gap is a missed poll.
    const recorded = [rec("A", 0), rec("D", 15), rec("E", 20)];
    const l = line({ recorded, offRoute: [at(16), at(18)] });
    expect(l.stops.map((s) => s.state)).toEqual([
      "recorded",
      "unrecorded",
      "unrecorded",
      "recorded",
      "recorded",
    ]);
    expect(l.bypasses).toEqual([]);
  });

  it("marks the stops after a cut-short run's last arrival as not served", () => {
    const l = line({ recorded: [rec("A", 0), rec("B", 5)], stage: "mid-trip" });
    expect(l.stops.map((s) => s.state)).toEqual([
      "recorded",
      "recorded",
      "not-served",
      "not-served",
      "not-served",
    ]);
    expect(l.legs.map((g) => g.kind)).toEqual(["run", "not-served", "not-served", "not-served"]);
  });

  it("marks every stop of a run cancelled before it started as not served", () => {
    const l = line({ stage: "before" });
    expect(new Set(l.stops.map((s) => s.state))).toEqual(new Set(["not-served"]));
  });

  it("greys the legs a live run has not reached yet", () => {
    const l = line({ recorded: [rec("A", 0), rec("B", 5)], live: true });
    expect(l.legs.map((g) => g.kind)).toEqual(["run", "ahead", "ahead", "ahead"]);
  });

  it("lists the recorded stops in their own order when there is no timetable", () => {
    const l = line({ scheduled: [], recorded: [rec("P", 0), rec("Q", 5)] });
    expect(l.stops.map((s) => [s.stop_id, s.offTimetable])).toEqual([
      ["P", false],
      ["Q", false],
    ]);
  });
});
