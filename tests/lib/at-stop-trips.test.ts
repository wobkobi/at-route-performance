// tests/lib/at-stop-trips.test.ts
// Unit tests for the stop-departures cache TTL rule and the departure order.
import { byServiceDeparture, stopTripsTtl, type ScheduledDeparture } from "@/lib/at-stop-trips";
import { describe, expect, it, vi } from "vitest";

// Only the fetcher is stubbed: `AtHttpError` stays real, because the module under test branches on
// `instanceof` and a stubbed class would make that test itself.
vi.mock("@/lib/at-static", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/at-static")>()),
  getJson: vi.fn(),
}));

/**
 * A departure at a GTFS time, the rest filler.
 * @param departureTime - "HH:MM:SS", or null for an untimed trip.
 * @returns The departure.
 */
const dep = (departureTime: string | null): ScheduledDeparture => ({
  tripId: `t-${departureTime}`,
  routeId: "r",
  headsign: null,
  directionId: null,
  departureTime,
});

describe("byServiceDeparture", () => {
  it("runs 4am to 4am, so a post-midnight run closes the list in either spelling", () => {
    const order = [
      dep(null),
      dep("00:30:00"),
      dep("23:50:00"),
      dep("24:45:00"),
      dep("04:10:00"),
      dep("9:05:00"),
    ]
      .sort(byServiceDeparture)
      .map((d) => d.departureTime);
    expect(order).toEqual(["04:10:00", "9:05:00", "23:50:00", "00:30:00", "24:45:00", null]);
  });
});

describe("stopTripsTtl", () => {
  // 2026-09-12 20:00 UTC is 13 Sep 08:00 NZST: service date 2026-09-13, UTC date 2026-09-12.
  const nzMorning = new Date("2026-09-12T20:00:00Z");

  it("holds today's and future dates for five minutes", () => {
    expect(stopTripsTtl("2026-09-13", nzMorning)).toBe(300);
    expect(stopTripsTtl("2026-09-14", nzMorning)).toBe(300);
  });

  it("holds a past service date for an hour", () => {
    expect(stopTripsTtl("2026-09-12", nzMorning)).toBe(3600);
  });

  it("judges today by the NZ service date, not the UTC calendar date", () => {
    // 13 Sep 03:00 NZST is still service date 2026-09-12 (the day starts at 4am)
    // and UTC date 2026-09-12: the day in progress stays on the short TTL.
    const preDawn = new Date("2026-09-12T15:00:00Z");
    expect(stopTripsTtl("2026-09-12", preDawn)).toBe(300);
    expect(stopTripsTtl("2026-09-13", preDawn)).toBe(300);
    expect(stopTripsTtl("2026-09-11", preDawn)).toBe(3600);
  });
});
