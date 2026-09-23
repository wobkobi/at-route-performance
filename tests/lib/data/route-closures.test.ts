// tests/lib/data/route-closures.test.ts
// How a stored closure reads for one day, and rule 26's filter over the arrivals timed at a stop
// while it was closed.
import { closedArrivalsMatch, toDayClosure } from "@/lib/data/route-closures";
import type { DayClosure } from "@/lib/strip-marks";
import type { StopClosure } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {}, runCommand: vi.fn() }));
vi.mock("@/lib/mem-cache", () => ({
  /**
   * Pass the factory straight through.
   * @param fn - The cached factory.
   * @returns The factory itself.
   */
  unstable_cache: (fn: () => unknown) => fn,
}));

/** 23 Sep 2026's service day, 4am to 4am NZ. */
const DAY = { start: new Date("2026-09-22T16:00:00Z"), end: new Date("2026-09-23T16:00:00Z") };

/**
 * A stored row, a seen detour unless told otherwise.
 * @param over - The fields to set.
 * @returns The row.
 */
function row(over: Partial<StopClosure>): StopClosure {
  return {
    id: "c1",
    routeId: "OUT-202",
    directionId: 0,
    kind: "detour",
    source: "seen",
    stopIds: [],
    fromStopId: "8226-1ed5b7ee",
    toStopId: "8033-7eb25754",
    alertId: null,
    effect: null,
    alert: null,
    runs: [],
    clears: [],
    confirmedAt: null,
    disputedAt: null,
    from: new Date("2026-09-22T20:00:00Z"),
    to: null,
    ...over,
  };
}

/**
 * A closure as the diagram reads it, closed by an alert unless told otherwise.
 * @param over - The fields to set.
 * @returns The closure.
 */
function closure(over: Partial<DayClosure>): DayClosure {
  return {
    kind: "closed",
    source: "alert",
    directionId: null,
    stopIds: [],
    fromStopId: null,
    toStopId: null,
    alert: null,
    runs: 0,
    confirmed: false,
    disputed: false,
    from: Date.parse("2026-09-22T20:00:00Z"),
    to: null,
    ...over,
  };
}

describe("toDayClosure", () => {
  it("counts only the day's runs, in epoch ms", () => {
    const c = toDayClosure(
      row({
        runs: [
          { tripId: "a", at: new Date("2026-09-21T22:00:00Z") },
          { tripId: "b", at: new Date("2026-09-22T21:00:00Z") },
          { tripId: "c", at: new Date("2026-09-22T22:00:00Z") },
        ],
      }),
      DAY,
    );
    expect(c.runs).toBe(2);
    expect(c.from).toBe(Date.parse("2026-09-22T20:00:00Z"));
    expect(c.to).toBeNull();
  });

  it("calls a trend or a dispute only once it was one by the day's end", () => {
    const later = new Date("2026-09-24T01:00:00Z");
    const during = new Date("2026-09-23T01:00:00Z");
    expect(toDayClosure(row({ confirmedAt: later }), DAY).confirmed).toBe(false);
    expect(toDayClosure(row({ confirmedAt: during }), DAY).confirmed).toBe(true);
    expect(toDayClosure(row({ disputedAt: during }), DAY).disputed).toBe(true);
  });
});

describe("closedArrivalsMatch (rule 26)", () => {
  it("is null when nothing closed a stop", () => {
    expect(closedArrivalsMatch([], new Map())).toBeNull();
    expect(
      closedArrivalsMatch([closure({ kind: "detour", stopIds: ["x"] })], new Map()),
    ).toBeNull();
  });

  it("leaves out an alert's stop any way, from its start to its end", () => {
    const to = Date.parse("2026-09-23T02:00:00Z");
    expect(closedArrivalsMatch([closure({ stopIds: ["8035-e0a62ca6"], to })], new Map())).toEqual({
      $nor: [
        {
          stopId: { $in: ["8035-e0a62ca6"] },
          actualAt: {
            $gte: { $date: "2026-09-22T20:00:00.000Z" },
            $lt: { $date: "2026-09-23T02:00:00.000Z" },
          },
        },
      ],
    });
  });

  it("leaves out a skipped stop only the way the runs went, and only once it was a trend", () => {
    const skip = closure({ source: "skipped", directionId: 1, stopIds: ["8034-39f76bd5"] });
    expect(closedArrivalsMatch([skip], new Map())).toBeNull();
    const match = closedArrivalsMatch([{ ...skip, confirmed: true }], new Map());
    expect(match).toEqual({
      $nor: [
        {
          stopId: { $in: ["8034-39f76bd5"] },
          actualAt: { $gte: { $date: "2026-09-22T20:00:00.000Z" } },
          "meta.directionId": 1,
        },
      ],
    });
  });

  it("closes a station the diagram draws as one across all its platforms", () => {
    const rawToCanon = new Map([
      ["9101", "station"],
      ["9102", "station"],
      ["other", "other"],
    ]);
    const match = closedArrivalsMatch([closure({ stopIds: ["9101"] })], rawToCanon) as {
      $nor: Array<{ stopId: { $in: string[] } }>;
    };
    expect(match.$nor[0]!.stopId.$in.toSorted()).toEqual(["9101", "9102"]);
  });
});
