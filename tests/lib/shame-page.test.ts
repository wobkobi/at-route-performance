// tests/lib/shame-page.test.ts
// Unit tests for the shame boards' shared param parsing: what each board filters
// on, what it says it filtered on, and what its links keep.
import {
  buildShameHref,
  parseShameParams,
  SHAME_PARAMS,
  subtitleWithDirection,
} from "@/lib/shame-page";
import { describe, expect, it } from "vitest";

describe("parseShameParams", () => {
  it("defaults to every mode, no school services and both directions", () => {
    const p = parseShameParams({});
    expect(p.filter).toEqual({ mode: null, includeSchool: false, direction: null });
    expect(p.view).toBe("day");
    expect(p.subtitle).toBe("Buses, trains & ferries");
    expect(p.preserved).toEqual({});
  });

  it("reads a direction and keeps it for the other controls' links", () => {
    const p = parseShameParams({ dir: "late", mode: "TRAIN", school: "1" });
    expect(p.direction).toBe("late");
    expect(p.preserved).toEqual({ mode: "TRAIN", school: "1", dir: "late" });
  });

  it("reads an unknown direction as both, so a bad link is not an empty board", () => {
    expect(parseShameParams({ dir: "sideways" }).direction).toBeNull();
    expect(parseShameParams({ dir: "" }).direction).toBeNull();
  });

  it("leaves the direction out of the subtitle, which the boards without it share", () => {
    expect(parseShameParams({ dir: "early", mode: "FERRY" }).subtitle).toBe("Ferries");
  });
});

describe("subtitleWithDirection", () => {
  it("names the direction the board was asked for", () => {
    expect(subtitleWithDirection("Trains", "late")).toBe("Trains · Late only");
    expect(subtitleWithDirection("Trains", "early")).toBe("Trains · Early only");
  });

  it("leaves the subtitle alone when both directions are shown", () => {
    expect(subtitleWithDirection("Trains", null)).toBe("Trains");
  });
});

describe("SHAME_PARAMS", () => {
  // `/shame` lands on the trips board, which has no direction to narrow, so
  // forwarding `dir` would put a param on a page that cannot act on it.
  it("does not forward the direction across the section redirect", () => {
    expect(SHAME_PARAMS).not.toContain("dir");
  });
});

describe("buildShameHref", () => {
  // The tab links are the only hrefs this builds, and the tab a reader is on is
  // rendered as a span - so every href it produces points at a board that reads
  // no direction.
  it("keeps mode and school but not the direction", () => {
    expect(
      buildShameHref(
        "/shame/trip",
        { day: "2026-09-20" },
        { mode: "BUS", includeSchool: true, direction: "late" },
      ),
    ).toBe("/shame/trip?day=2026-09-20&mode=BUS&school=1");
  });
});
