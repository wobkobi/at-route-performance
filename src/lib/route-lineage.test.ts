// src/lib/route-lineage.test.ts
/**
 * @description Unit tests for the CRL train-line succession map in route-lineage.ts.
 */
import { predecessorSlugs, successorSlugs } from "@/lib/route-lineage";
import { describe, expect, it } from "vitest";

describe("predecessorSlugs", () => {
  it("maps each CRL line back to the lines it replaces", () => {
    expect(predecessorSlugs("S-C")).toEqual(["STH"]);
    expect(predecessorSlugs("O-W")).toEqual(["ONE"]);
  });

  it("gives the merged line both of its predecessors", () => {
    expect(predecessorSlugs("E-W")).toEqual(["EAST", "WEST"]);
  });

  it("accepts the unhyphenated code AT may publish as the route id", () => {
    expect(predecessorSlugs("SC")).toEqual(["STH"]);
    expect(predecessorSlugs("ew")).toEqual(["EAST", "WEST"]);
  });

  it("leaves every other route alone", () => {
    expect(predecessorSlugs("STH")).toEqual([]);
    expect(predecessorSlugs("NX1")).toEqual([]);
    expect(predecessorSlugs("HUIA")).toEqual([]);
    expect(predecessorSlugs("501")).toEqual([]);
  });
});

describe("successorSlugs", () => {
  it("offers the hyphenated code first, then the flattened fallback", () => {
    expect(successorSlugs("STH")).toEqual(["S-C", "SC"]);
    expect(successorSlugs("ONE")).toEqual(["O-W", "OW"]);
  });

  it("sends both merged lines to the same successor", () => {
    expect(successorSlugs("EAST")).toEqual(["E-W", "EW"]);
    expect(successorSlugs("WEST")).toEqual(["E-W", "EW"]);
  });

  it("is empty for lines that are not retired", () => {
    expect(successorSlugs("S-C")).toEqual([]);
    expect(successorSlugs("HUIA")).toEqual([]);
    expect(successorSlugs("NX1")).toEqual([]);
  });

  it("round-trips with predecessorSlugs", () => {
    for (const retired of ["STH", "EAST", "WEST", "ONE"]) {
      const [successor] = successorSlugs(retired);
      expect(predecessorSlugs(successor)).toContain(retired);
    }
  });
});
