// tests/lib/at-stop-trips.test.ts
// Unit tests for the stop-departures cache TTL rule.
import { stopTripsTtl } from "@/lib/at-stop-trips";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/at-static", () => ({ getJson: vi.fn() }));

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
