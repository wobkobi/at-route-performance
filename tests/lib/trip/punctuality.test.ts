// tests/lib/trip/punctuality.test.ts
// Tests AT's trip measures: which readings stand for the departure and arrival, and the windows.
import {
  addVerdict,
  emptyCounts,
  judgeTrip,
  punctualPct,
  reliablePct,
  type EndReading,
  type TripEnds,
} from "@/lib/trip/punctuality";
import { describe, expect, it } from "vitest";

const ENDS: TripEnds = { startStopIds: ["a", "b", "c"], lastStopId: "z" };
const LOOP: TripEnds = { startStopIds: ["a", "b", "c"], lastStopId: "a" };

/**
 * A reading at a stop.
 * @param stopId - Stop id.
 * @param min - Scheduled minute of the day, for ordering.
 * @param deviationSec - Signed deviation.
 * @returns The reading.
 */
function at(stopId: string, min: number, deviationSec: number): EndReading {
  return { stopId, scheduledMs: min * 60_000, deviationSec };
}

describe("judgeTrip", () => {
  it("passes a trip inside both windows", () => {
    expect(judgeTrip([at("a", 0, 0), at("z", 30, 120)], ENDS)).toEqual({
      reliable: true,
      punctual: true,
    });
  });

  it("holds the departure window's edges: 1 min early, 5 min late, 10 min late", () => {
    expect(judgeTrip([at("a", 0, -60), at("z", 30, 0)], ENDS).punctual).toBe(true);
    expect(judgeTrip([at("a", 0, -61), at("z", 30, 0)], ENDS)).toEqual({
      reliable: false,
      punctual: false,
    });
    expect(judgeTrip([at("a", 0, 300), at("z", 30, 0)], ENDS).punctual).toBe(true);
    expect(judgeTrip([at("a", 0, 301), at("z", 30, 0)], ENDS)).toEqual({
      reliable: true,
      punctual: false,
    });
    expect(judgeTrip([at("a", 0, 600)], ENDS).reliable).toBe(true);
    expect(judgeTrip([at("a", 0, 601)], ENDS).reliable).toBe(false);
  });

  it("fails a punctual departure that arrives more than 5 min late, but never for being early", () => {
    expect(judgeTrip([at("a", 0, 0), at("z", 30, 301)], ENDS).punctual).toBe(false);
    expect(judgeTrip([at("a", 0, 0), at("z", 30, -600)], ENDS).punctual).toBe(true);
  });

  it("takes the departure from the next opening stop when the first was not read", () => {
    expect(judgeTrip([at("b", 2, 400), at("c", 4, 0), at("z", 30, 0)], ENDS)).toEqual({
      reliable: true,
      punctual: false,
    });
  });

  it("cannot judge a trip with no opening stop read, and judges reliability alone with no arrival", () => {
    expect(judgeTrip([at("m", 10, 0), at("z", 30, 0)], ENDS)).toEqual({
      reliable: null,
      punctual: null,
    });
    expect(judgeTrip([at("a", 0, 0)], ENDS)).toEqual({ reliable: true, punctual: null });
  });

  it("reads both visits to a loop's terminus as departure then arrival", () => {
    expect(judgeTrip([at("a", 60, 400), at("a", 0, 0)], LOOP)).toEqual({
      reliable: true,
      punctual: false,
    });
  });

  it("does not take a loop's lone terminus reading as its departure", () => {
    // The one reading at `a` could be the arrival, so the departure comes from `b`.
    expect(judgeTrip([at("a", 60, 0), at("b", 2, 700)], LOOP)).toEqual({
      reliable: false,
      punctual: false,
    });
    // A departure read at `a` and nothing after it: no arrival to judge.
    expect(judgeTrip([at("a", 0, 0)], LOOP)).toEqual({ reliable: null, punctual: null });
    expect(judgeTrip([at("a", 0, 0), at("b", 2, 0)], LOOP)).toEqual({
      reliable: true,
      punctual: null,
    });
  });
});

describe("punctualPct and reliablePct", () => {
  it("count cancelled trips as failures and give null with nothing judged", () => {
    const c = emptyCounts();
    expect(punctualPct(c)).toBeNull();
    addVerdict(c, { reliable: true, punctual: true });
    addVerdict(c, { reliable: true, punctual: null });
    addVerdict(c, { reliable: false, punctual: false });
    c.cancelled = 1;
    expect(c).toEqual({ departed: 3, reliable: 2, timed: 2, punctual: 1, cancelled: 1 });
    expect(punctualPct(c)).toBeCloseTo(100 / 3);
    expect(reliablePct(c)).toBe(50);
  });
});
