// tests/lib/compare.test.ts
import {
  MAX_COMPARE,
  bestColumns,
  parseCompareIds,
  parseCompareKind,
  toggleCompareId,
} from "@/lib/compare";
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
