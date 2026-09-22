// tests/lib/label-width.test.ts
// Unit tests for the diagram label widths read from Gotham Narrow Ultra.
import { labelWidth } from "@/lib/label-width";
import { describe, expect, it } from "vitest";

describe("labelWidth", () => {
  it("sums the font's advance widths at the given size", () => {
    // 4 m space 8 s space l a t e, from the Ultra hmtx table.
    expect(labelWidth("4m 8s late", 12)).toBeCloseTo(56.7, 1);
    expect(labelWidth("Britomart", 14)).toBeCloseTo(62.2, 1);
  });

  it("scales with the font size", () => {
    expect(labelWidth("on time", 24)).toBeCloseTo(labelWidth("on time", 12) * 2, 6);
  });

  it("counts the ellipsis a truncated label ends in", () => {
    expect(labelWidth("…", 10)).toBeCloseTo(7.72, 6);
  });

  it("gives an unlisted glyph a capital's width", () => {
    expect(labelWidth("Ō", 10)).toBeCloseTo(7, 6);
  });

  it("is zero for no text", () => {
    expect(labelWidth("", 12)).toBe(0);
  });
});
