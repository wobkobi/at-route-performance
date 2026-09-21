// tests/lib/trip-id.test.ts
// Unit tests for reading a run's scheduled start out of AT's identifiers, and
// for the parts of a trip id the ghost pass reads: the block-and-service prefix
// that bounds a sibling lookup, and the variant hash that says which timetable
// pattern a slot belongs to.
import {
  gtfsTimeSeconds,
  tripIdPrefix,
  tripIdStartSeconds,
  tripIdVariantHash,
} from "@/lib/trip-id";
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

describe("tripIdPrefix", () => {
  it("takes the block and service segments, with the separator", () => {
    expect(tripIdPrefix("1108-15203-78300-2-58ac9d51")).toBe("1108-15203-");
  });

  it("gives up on an id with nothing to bound", () => {
    expect(tripIdPrefix("1108")).toBeNull();
    expect(tripIdPrefix("")).toBeNull();
  });
});

describe("tripIdVariantHash", () => {
  it("takes the last segment, on a five- or six-segment id", () => {
    expect(tripIdVariantHash("1108-15203-81900-2-6dc59f13")).toBe("6dc59f13");
    // Six-segment train id: the hash is still the last segment.
    expect(tripIdVariantHash("247-810010-64380-2-9156552-e4863dae")).toBe("e4863dae");
  });

  it("gives up on an id with no segments", () => {
    expect(tripIdVariantHash("1108")).toBeNull();
  });

  it("separates the four slots that share one start under a prefix", () => {
    // 522a02b3, 6dc59f13, a61a2b9e and db5ac5bb all start at 81900 under
    // 1108-15203, and only one of them belongs to the pattern that ran.
    const ids = [
      "1108-15203-81900-2-522a02b3",
      "1108-15203-81900-2-6dc59f13",
      "1108-15203-81900-2-a61a2b9e",
      "1108-15203-81900-2-db5ac5bb",
    ];
    expect(ids.every((id) => tripIdStartSeconds(id) === 81_900)).toBe(true);
    expect(new Set(ids.map(tripIdVariantHash)).size).toBe(4);
  });
});
