// tests/lib/route/colour.test.ts
// Route colours: a route's own (its icon, the live map) falling back to its
// mode's, and the one Shore every single route's line is drawn in.
import { modeGlyph } from "@/components/ModeIcon";
import { MODE_ICON_CLASS, MODE_ICON_HEX, MODES } from "@/lib/mode";
import { PALETTE } from "@/lib/palette";
import { brandColour, ROUTE_LINE_HEX, routeColour } from "@/lib/route/colour";
import { describe, expect, it } from "vitest";

describe("brandColour", () => {
  it("reads AT's six hex digits", () => {
    expect(brandColour("F9A22E")).toBe("#F9A22E");
  });

  it("keeps black, which AT publishes for some routes", () => {
    expect(brandColour("000000")).toBe("#000000");
  });

  it("treats malformed and missing values as no colour", () => {
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
    expect(routeColour("TRAIN", "")).toBe(PALETTE.shore);
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

  it("leaves a Link's own colour to the icon, keeping the bus colour as its fallback", () => {
    expect(modeGlyph("BUS", "OUT").colourClass).toBe(MODE_ICON_CLASS.BUS);
  });
});

describe("ROUTE_LINE_HEX", () => {
  it("is Shore, the mode colour of bus and train", () => {
    expect(ROUTE_LINE_HEX).toBe(PALETTE.shore);
    expect(ROUTE_LINE_HEX).toBe(MODE_ICON_HEX.BUS);
  });
});
