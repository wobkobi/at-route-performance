// tests/lib/school-bus.test.ts
// Unit tests for the school-bus route-code classifier in school-bus.ts.

import {
  isSchoolBus,
  parseSchoolFilter,
  rowAllowedBySchool,
  schoolAllows,
  schoolDelta,
  schoolFilterParam,
} from "@/lib/school-bus";
import { describe, expect, it } from "vitest";

describe("isSchoolBus", () => {
  it("matches S + three digits with an optional variant letter (any case)", () => {
    expect(isSchoolBus("S123")).toBe(true);
    expect(isSchoolBus("s007")).toBe(true);
    expect(isSchoolBus("S046D")).toBe(true);
    expect(isSchoolBus("S001N")).toBe(true);
  });

  it("catches the code when it is in the long name (short name is the plain number)", () => {
    expect(isSchoolBus("046", "S046D")).toBe(true);
    expect(isSchoolBus("002", "S002A")).toBe(true);
  });

  it("rejects normal routes and edge cases", () => {
    expect(isSchoolBus("70")).toBe(false);
    expect(isSchoolBus("NX1")).toBe(false);
    expect(isSchoolBus("S12")).toBe(false); // only two digits
    expect(isSchoolBus("S1234")).toBe(false); // four digits
    expect(isSchoolBus("STH")).toBe(false); // train line
    expect(isSchoolBus("046", "Britomart To Pt Chevalier")).toBe(false);
    expect(isSchoolBus(null)).toBe(false);
    expect(isSchoolBus(undefined)).toBe(false);
    expect(isSchoolBus()).toBe(false);
  });
});

describe("schoolDelta", () => {
  const rows = [
    { shortName: "70", longName: "Botany to Britomart", events: 1000 },
    { shortName: "046", longName: "S046", events: 120 },
    { shortName: "112", longName: "S112", events: 80 },
  ];

  it("counts the school routes and their arrivals, and the cancelled difference", () => {
    expect(schoolDelta(rows, 12, 9)).toEqual({ events: 200, cancelled: 3, route_count: 2 });
  });

  it("never reports a negative cancellation change, nor one from an unknown count", () => {
    expect(schoolDelta(rows, 5, 7).cancelled).toBe(0);
    expect(schoolDelta(rows, null, null).cancelled).toBe(0);
  });
});

describe("parseSchoolFilter", () => {
  it("reads the old on switch as include, only as only, and anything else as the default", () => {
    expect(parseSchoolFilter("1")).toBe("include");
    expect(parseSchoolFilter("only")).toBe("only");
    expect(parseSchoolFilter(undefined)).toBe("exclude");
    expect(parseSchoolFilter("yes")).toBe("exclude");
  });

  it("round-trips through the param, which the default leaves off", () => {
    for (const f of ["exclude", "include", "only"] as const) {
      expect(parseSchoolFilter(schoolFilterParam(f))).toBe(f);
    }
    expect(schoolFilterParam("exclude")).toBeUndefined();
  });
});

describe("schoolAllows", () => {
  it("keeps ordinary services, every service, or school ones alone", () => {
    expect([schoolAllows("exclude", false), schoolAllows("exclude", true)]).toEqual([true, false]);
    expect([schoolAllows("include", false), schoolAllows("include", true)]).toEqual([true, true]);
    expect([schoolAllows("only", false), schoolAllows("only", true)]).toEqual([false, true]);
  });
});

describe("rowAllowedBySchool", () => {
  it("judges a row by the school code in either of its names", () => {
    const school = { shortName: "046", longName: "S046D" };
    const ordinary = { shortName: "70", longName: null };
    expect([
      rowAllowedBySchool(school, "exclude"),
      rowAllowedBySchool(ordinary, "exclude"),
    ]).toEqual([false, true]);
    expect([rowAllowedBySchool(school, "only"), rowAllowedBySchool(ordinary, "only")]).toEqual([
      true,
      false,
    ]);
  });
});
