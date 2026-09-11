// src/lib/brand-colour.test.ts
/**
 * @description Unit tests for the feed-colour legibility check in brand-colour.ts.
 */
import { isLegibleOnSurface, relativeLuminance } from "@/lib/brand-colour";
import { describe, expect, it } from "vitest";

describe("relativeLuminance", () => {
  it("puts white at 1 and black at 0", () => {
    expect(relativeLuminance("ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("000000")).toBeCloseTo(0, 5);
  });

  it("rejects anything that isn't a six-digit hex triple", () => {
    expect(relativeLuminance("fff")).toBeNull();
    expect(relativeLuminance("#ffffff")).toBeNull();
    expect(relativeLuminance("zzzzzz")).toBeNull();
  });
});

describe("isLegibleOnSurface", () => {
  it("rejects AT's real illegible feed colours", () => {
    // Eastern Line yellow: about 1.7:1 on white, effectively invisible.
    expect(isLegibleOnSurface("FDB913")).toBe(false);
  });

  it("keeps AT's feed colours that do carry", () => {
    expect(isLegibleOnSurface("D52923")).toBe(true); // Southern Line red
    expect(isLegibleOnSurface("000000")).toBe(true); // Te Huia black
  });

  it("treats a missing or malformed colour as unusable", () => {
    expect(isLegibleOnSurface(null)).toBe(false);
    expect(isLegibleOnSurface(undefined)).toBe(false);
    expect(isLegibleOnSurface("")).toBe(false);
    expect(isLegibleOnSurface("nope")).toBe(false);
  });
});
