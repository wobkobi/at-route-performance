// src/lib/stop-sums.test.ts
// Unit tests for merging and ranking per-day stop sums.
import { mergeStopDays, rankStopSums } from "@/lib/stop-sums";
import { describe, expect, it } from "vitest";

describe("mergeStopDays", () => {
  it("adds sums across days and unions the routes", () => {
    const merged = mergeStopDays([
      [{ s: "a", e: 10, d: 100, a: 300, r: ["1", "2"] }],
      [
        { s: "a", e: 30, d: -60, a: 900, r: ["2", "3"] },
        { s: "b", e: 5, d: 5, a: 5, r: ["4"] },
      ],
    ]);
    expect(merged.find((m) => m.stopId === "a")).toEqual({
      stopId: "a",
      events: 40,
      signedSum: 40,
      absSum: 1200,
      routeIds: ["1", "2", "3"],
    });
    expect(merged).toHaveLength(2);
  });

  it("weights each day by its arrivals, not one vote per day", () => {
    // A quiet day 600s off and a busy day 60s off: weighted by arrivals that is
    // (600*10 + 60*90) / 100 = 114s, where an average of the two days is 330s.
    const [a] = mergeStopDays([
      [{ s: "a", e: 10, d: 0, a: 6000, r: [] }],
      [{ s: "a", e: 90, d: 0, a: 5400, r: [] }],
    ]);
    expect(a!.absSum / a!.events).toBe(114);
  });
});

describe("rankStopSums", () => {
  const sums = [
    { stopId: "thin", events: 5, signedSum: 0, absSum: 5000, routeIds: [] },
    { stopId: "mild", events: 40, signedSum: 0, absSum: 2400, routeIds: [] },
    { stopId: "bad", events: 20, signedSum: 0, absSum: 4000, routeIds: [] },
  ];

  it("drops thin stops and puts the furthest off first", () => {
    expect(rankStopSums(sums, 20, 10).map((s) => s.stopId)).toEqual(["bad", "mild"]);
  });

  it("keeps only the limit", () => {
    expect(rankStopSums(sums, 20, 1).map((s) => s.stopId)).toEqual(["bad"]);
  });
});
