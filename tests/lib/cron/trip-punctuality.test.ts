// tests/lib/cron/trip-punctuality.test.ts
// Tests the nightly trip-measure tally: cancellations, the read's bounds and the stored fields.
import {
  punctualityUpdateOps,
  routePunctuality,
  tripEndsPipeline,
  type TripEndsRow,
} from "@/lib/cron/trip-punctuality";
import { nzServiceDayRange } from "@/lib/time/service-day";
import { emptyCounts } from "@/lib/trip/punctuality";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

/**
 * A trip on route 70 read at its first and last stops.
 * @param id - Trip id.
 * @param depSec - Departure deviation.
 * @param arrSec - Arrival deviation.
 * @returns The row.
 */
function trip(id: string, depSec: number, arrSec: number): TripEndsRow {
  return {
    _id: id,
    routeId: "70-203",
    starts: ["a", "b"],
    last: "z",
    r: [
      { s: "a", t: { $date: "2026-10-02T19:00:00.000Z" }, d: depSec },
      { s: "z", t: "2026-10-02T19:40:00.000Z", d: arrSec },
    ],
  };
}

describe("routePunctuality", () => {
  it("judges each trip and files it under its route", () => {
    const counts = routePunctuality([trip("t1", 0, 0), trip("t2", 400, 0)], []);
    expect(counts.get("70-203")).toEqual({
      departed: 2,
      reliable: 2,
      timed: 2,
      punctual: 1,
      cancelled: 0,
    });
  });

  it("counts a never-ran or cut-short trip once, as a cancellation, and judges a reinstated one", () => {
    const counts = routePunctuality(
      [trip("cut", 0, 0), trip("back", 0, 0)],
      [
        { tripId: "cut", routeId: "70-203", stage: "mid-trip" },
        { tripId: "gone", routeId: "NX1-203", stage: "before" },
        { tripId: "back", routeId: "70-203", stage: "ran" },
      ],
    );
    expect(counts.get("70-203")).toEqual({
      departed: 1,
      reliable: 1,
      timed: 1,
      punctual: 1,
      cancelled: 1,
    });
    expect(counts.get("NX1-203")).toEqual({ ...emptyCounts(), cancelled: 1 });
  });
});

describe("tripEndsPipeline", () => {
  it("bounds the read by the day's scan window and its stamped service date", () => {
    const match = (tripEndsPipeline("2026-10-02")[0] as { $match: Record<string, unknown> }).$match;
    expect(match.serviceDate).toBe("2026-10-02");
    expect(match.scheduledAt).toHaveProperty("$gte");
    expect(match.scheduledAt).toHaveProperty("$lt");
    expect(match.ghost).toEqual({ $ne: true });
  });
});

describe("punctualityUpdateOps", () => {
  it("sets the tallies on the route's row for the day, without upserting", () => {
    const { start, end } = nzServiceDayRange("2026-10-02");
    const ops = punctualityUpdateOps(
      new Map([["70-203", { departed: 9, reliable: 8, timed: 7, punctual: 6, cancelled: 1 }]]),
      "2026-10-02",
    );
    expect(ops).toEqual([
      {
        q: {
          routeId: "70-203",
          date: { $gte: { $date: start.toISOString() }, $lt: { $date: end.toISOString() } },
        },
        u: {
          $set: {
            tripsDeparted: 9,
            tripsReliable: 8,
            tripsTimed: 7,
            tripsPunctual: 6,
            tripsCancelled: 1,
          },
        },
      },
    ]);
  });
});
