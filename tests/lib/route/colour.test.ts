// tests/lib/route/colour.test.ts
// Route line colours, and the one-colour-per-mode icon they fall back to.
import { modeGlyph } from "@/components/ModeIcon";
import { MODE_ICON_CLASS, MODE_ICON_HEX, MODES } from "@/lib/mode";
import { PALETTE } from "@/lib/palette";
import { brandColour, routeColour } from "@/lib/route/colour";
import { describe, expect, it } from "vitest";

describe("brandColour", () => {
  it("reads AT's six hex digits", () => {
    expect(brandColour("F9A22E")).toBe("#F9A22E");
  });

  it("treats black, malformed and missing values as no colour", () => {
    expect(brandColour("000000")).toBeNull();
    expect(brandColour("#f9a22e")).toBeNull();
    expect(brandColour("fff")).toBeNull();
    expect(brandColour("")).toBeNull();
    expect(brandColour(null)).toBeNull();
  });
});

describe("routeColour", () => {
  it("uses AT's colour when there is one", () => {
    expect(routeColour("BUS", "f9a22e")).toBe("#f9a22e");
  });

  it("falls back to the mode's icon colour", () => {
    expect(routeColour("BUS", null)).toBe(PALETTE.shore);
    expect(routeColour("TRAIN", "000000")).toBe(PALETTE.shore);
    expect(routeColour("FERRY", undefined)).toBe(PALETTE["greeny-bluey"]);
    expect(routeColour("TRAM", null)).toBe(PALETTE.shore);
  });
});

describe("modeGlyph", () => {
  it("colours every route of a mode alike", () => {
    for (const mode of MODES) {
      const glyph = modeGlyph(mode);
      expect(glyph.colourClass).toBe(MODE_ICON_CLASS[mode]);
      expect(glyph.hex).toBe(MODE_ICON_HEX[mode]);
    }
  });

  it("keeps the school glyph and label, in the bus colour", () => {
    const school = modeGlyph("BUS", "S123");
    const bus = modeGlyph("BUS", "70");
    expect(school.label).toBe("School bus");
    expect(school.Icon).not.toBe(bus.Icon);
    expect(school.colourClass).toBe(bus.colourClass);
  });

  it("gives Link services the bus colour too", () => {
    expect(modeGlyph("BUS", "OUT").colourClass).toBe(MODE_ICON_CLASS.BUS);
  });
});
