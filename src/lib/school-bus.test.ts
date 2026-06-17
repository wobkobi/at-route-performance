import { isSchoolBus } from "@/lib/school-bus";
import { describe, expect, it } from "vitest";

describe("isSchoolBus", () => {
  it("matches S + three digits (any case)", () => {
    expect(isSchoolBus("S123")).toBe(true);
    expect(isSchoolBus("s007")).toBe(true);
  });
  it("rejects normal routes and edge cases", () => {
    expect(isSchoolBus("70")).toBe(false);
    expect(isSchoolBus("NX1")).toBe(false);
    expect(isSchoolBus("S12")).toBe(false); // only two digits
    expect(isSchoolBus("S1234")).toBe(false); // four digits
    expect(isSchoolBus("STH")).toBe(false); // train line
    expect(isSchoolBus(null)).toBe(false);
    expect(isSchoolBus(undefined)).toBe(false);
  });
});
