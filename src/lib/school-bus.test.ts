// src/lib/school-bus.test.ts
/**
 * @description Unit tests for the school-bus route-code classifier in school-bus.ts.
 */
import { isSchoolBus } from "@/lib/school-bus";
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
