// tests/lib/label-width.test.ts
// Unit tests for the diagram label widths read from Gotham Narrow Ultra.
import { fitLabel, labelWidth } from "@/lib/label-width";
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

describe("fitLabel", () => {
  it("leaves a label that fits alone", () => {
    expect(fitLabel("Britomart", 14, 100)).toBe("Britomart");
  });

  it("trims a long label to fit, ending in an ellipsis", () => {
    const out = fitLabel("Papatoetoe Train Station", 14, 100);
    expect(out.endsWith("…")).toBe(true);
    expect(labelWidth(out, 14)).toBeLessThanOrEqual(100);
    expect(labelWidth(`${out.slice(0, -1)}X…`, 14)).toBeGreaterThan(100);
  });

  it("drops the space before the ellipsis", () => {
    expect(fitLabel("ab cd", 10, labelWidth("ab …", 10))).toBe("ab…");
  });

  it("is empty when not even the ellipsis fits", () => {
    expect(fitLabel("Britomart", 14, 5)).toBe("");
  });
});
