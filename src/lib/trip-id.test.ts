// src/lib/trip-id.test.ts
// Unit tests for reading a run's scheduled start out of AT's identifiers.
import { gtfsTimeSeconds, tripIdStartSeconds } from "@/lib/trip-id";
import { describe, expect, it } from "vitest";

describe("gtfsTimeSeconds", () => {
  it("reads a plain and an extended GTFS time", () => {
    expect(gtfsTimeSeconds("07:30:15")).toBe(7 * 3600 + 30 * 60 + 15);
    expect(gtfsTimeSeconds("24:15:00")).toBe(24 * 3600 + 15 * 60);
  });
  it("gives up on anything that is not HH:MM:SS", () => {
    expect(gtfsTimeSeconds(null)).toBeNull();
    expect(gtfsTimeSeconds("7:3")).toBeNull();
    expect(gtfsTimeSeconds("07:61:00")).toBeNull();
  });
});

describe("tripIdStartSeconds", () => {
  it("reads the start seconds from the third segment", () => {
    expect(tripIdStartSeconds("1060-14804-82800-2-efb6f52a")).toBe(82800);
    // Six-segment ids keep the same third segment.
    expect(tripIdStartSeconds("122-91011-23400-2-512006552-42990445")).toBe(23_400);
    expect(tripIdStartSeconds("247-810010-64380-2-9156552-e4863dae")).toBe(64_380);
  });
  it("gives up on another shape, and at or past 48 h", () => {
    expect(tripIdStartSeconds("abc")).toBeNull();
    expect(tripIdStartSeconds("1060-14804-x-2-efb6f52a")).toBeNull();
    expect(tripIdStartSeconds("1-2-172800-2-abc")).toBeNull();
  });
});
