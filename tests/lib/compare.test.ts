// tests/lib/compare.test.ts
import {
  MAX_COMPARE,
  bestColumns,
  matchRoutes,
  parseCompareIds,
  parseCompareKind,
  stopCandidate,
  toggleCompareId,
  type CompareCandidate,
} from "@/lib/compare";
import type { Mode } from "@/lib/mode";
import { describe, expect, it } from "vitest";

describe("parseCompareKind", () => {
  it("reads stops, and falls back to routes for anything else", () => {
    expect(parseCompareKind("stops")).toBe("stops");
    expect(parseCompareKind("trains")).toBe("routes");
    expect(parseCompareKind(undefined)).toBe("routes");
  });
});

describe("parseCompareIds", () => {
  it("trims, drops blanks and repeats, and keeps the order given", () => {
    expect(parseCompareIds(" 70, NX1,,70 ,OUT")).toEqual(["70", "NX1", "OUT"]);
  });

  it("stops at the most one comparison holds", () => {
    expect(parseCompareIds("a,b,c,d,e,f")).toHaveLength(MAX_COMPARE);
  });

  it("keeps a station id's colon intact", () => {
    expect(parseCompareIds("station:133-2ee4f9c0,8503")).toEqual(["station:133-2ee4f9c0", "8503"]);
  });
});

describe("toggleCompareId", () => {
  it("adds an id to the end, and removes one already there", () => {
    expect(toggleCompareId(["70"], "NX1")).toBe("70,NX1");
    expect(toggleCompareId(["70", "NX1"], "70")).toBe("NX1");
  });

  it("gives null when the last id goes", () => {
    expect(toggleCompareId(["70"], "70")).toBeNull();
  });
});

describe("bestColumns", () => {
  it("marks the highest or the lowest, ties included", () => {
    expect([...bestColumns([60, 72, 72, null], "high")]).toEqual([1, 2]);
    expect([...bestColumns([120, 95, 300], "low")]).toEqual([1]);
  });

  it("marks nothing with one value or when every value ties", () => {
    expect(bestColumns([60, null], "high").size).toBe(0);
    expect(bestColumns([5, 5], "low").size).toBe(0);
  });
});

describe("matchRoutes", () => {
  /**
   * A route candidate for the matcher.
   * @param shortName - The code.
   * @param mode - The mode.
   * @param longName - AT's long name.
   * @returns The candidate.
   */
  const route = (
    shortName: string,
    mode: Mode = "BUS",
    longName = shortName,
  ): CompareCandidate => ({
    id: shortName,
    name: shortName,
    detail: null,
    route: { mode, shortName, longName, colour: null },
  });
  // Busiest first, as the page passes them.
  const options = [
    route("70"),
    route("CTY"),
    route("700"),
    route("STH", "TRAIN"),
    route("7", "BUS", "Pt England"),
  ];

  it("puts an exact code first, then codes that start with it, in the order given", () => {
    expect(matchRoutes(options, "70", []).map((c) => c.id)).toEqual(["70", "700"]);
    expect(matchRoutes(options, "7", []).map((c) => c.id)).toEqual(["7", "70", "700"]);
  });

  it("finds a route by its published name, folding case and spaces", () => {
    expect(matchRoutes(options, "city link", []).map((c) => c.id)).toEqual(["CTY"]);
    expect(matchRoutes(options, "Southern", []).map((c) => c.id)).toEqual(["STH"]);
    expect(matchRoutes(options, "england", []).map((c) => c.id)).toEqual(["7"]);
  });

  it("leaves out what is already compared, and matches nothing on blank text", () => {
    expect(matchRoutes(options, "70", ["70"]).map((c) => c.id)).toEqual(["700"]);
    expect(matchRoutes(options, "  ", [])).toEqual([]);
  });
});

describe("stopCandidate", () => {
  it("names a stop by its code and a station as a station", () => {
    expect(stopCandidate({ id: "8503", name: "Queen St", code: "8503" }).detail).toBe("Stop 8503");
    expect(stopCandidate({ id: "station:133-x", name: "Britomart", code: null }).detail).toBe(
      "Station",
    );
  });
});
