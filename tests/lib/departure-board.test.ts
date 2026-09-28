import type { ScheduledDeparture } from "@/lib/at-stop-trips";
import { departuresFromNow, serviceClockNow } from "@/lib/departure-board";
import { describe, expect, it } from "vitest";

/**
 * A departure at a GTFS time, with the fields the filter does not read left bare.
 * @param departureTime - The GTFS `HH:MM:SS`, or null for a row AT gave no time.
 * @returns The departure.
 */
function dep(departureTime: string | null): ScheduledDeparture {
  return {
    tripId: `t-${departureTime}`,
    routeId: "r",
    stopId: "s",
    headsign: null,
    stopHeadsign: null,
    directionId: null,
    departureTime,
  };
}

/**
 * An instant, written as UTC so the NZ offset is visible in each caller's comment
 * rather than hidden in a local-time string the test runner's zone would shift.
 * @param iso - A UTC ISO instant.
 * @returns The date.
 */
function nz(iso: string): Date {
  return new Date(iso);
}

describe("serviceClockNow", () => {
  it("places an afternoon instant on the day it belongs to", () => {
    // 2:15pm NZST on 25 Sep 2026 is 02:15 UTC.
    expect(serviceClockNow("2026-09-25", nz("2026-09-25T02:15:00Z"))).toBe(14 * 3600 + 15 * 60);
  });

  it("keeps after-midnight on the service day that is still running", () => {
    // 12:30am on 26 Sep is still the 25th's service day, and reads as 24:30.
    expect(serviceClockNow("2026-09-25", nz("2026-09-25T12:30:00Z"))).toBe(24 * 3600 + 30 * 60);
  });

  it("says nothing for a day that is not the one running", () => {
    expect(serviceClockNow("2026-09-20", nz("2026-09-25T02:15:00Z"))).toBeNull();
  });

  it("says nothing before the shown day has started", () => {
    expect(serviceClockNow("2026-09-26", nz("2026-09-25T02:15:00Z"))).toBeNull();
  });
});

describe("departuresFromNow", () => {
  const day = [dep("05:10:00"), dep("14:20:00"), dep("14:20:30"), dep("23:46:00"), dep("24:16:00")];

  it("drops what has gone and keeps what is due", () => {
    expect(departuresFromNow(day, 14 * 3600 + 20 * 60).map((d) => d.departureTime)).toEqual([
      "14:20:00",
      "14:20:30",
      "23:46:00",
      "24:16:00",
    ]);
  });

  it("keeps an after-midnight departure while the day still runs", () => {
    expect(departuresFromNow(day, 24 * 3600).map((d) => d.departureTime)).toEqual(["24:16:00"]);
  });

  it("empties once the last departure has gone", () => {
    expect(departuresFromNow(day, 25 * 3600)).toEqual([]);
  });

  it("keeps a departure AT gave no time", () => {
    expect(departuresFromNow([dep("05:10:00"), dep(null)], 20 * 3600)).toEqual([dep(null)]);
  });
});
