// tests/lib/map/style.test.ts
// The maps' colour reads and popup escaping. Tests run in node, so the document
// and its computed style are stubbed per test.
import { bandColours, bandTextColours, cssVar, escapeHtml } from "@/lib/map/style";
import { PALETTE } from "@/lib/palette";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Stub the root's computed style with a set of custom properties.
 * @param vars - Each property's value, as the stylesheet would give it.
 */
function stubTokens(vars: Record<string, string>): void {
  const style = { getPropertyValue: vi.fn((name: string) => vars[name] ?? "") };
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("getComputedStyle", vi.fn().mockReturnValue(style));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cssVar", () => {
  it("trims the computed value", () => {
    stubTokens({ "--color-at-late": "  #c00 " });
    expect(cssVar("--color-at-late")).toBe("#c00");
  });

  it("gives an empty string for an unset property", () => {
    stubTokens({});
    expect(cssVar("--color-at-late")).toBe("");
  });
});

describe("bandColours", () => {
  it("reads each band's token", () => {
    stubTokens({
      "--color-at-late": "#111",
      "--color-at-early": "#222",
      "--color-at-ontime": "#333",
      "--color-at-muted": "#444",
    });
    expect(bandColours()).toEqual({ late: "#111", early: "#222", ontime: "#333", none: "#444" });
  });

  it("falls back to the palette before the stylesheet applies", () => {
    stubTokens({});
    expect(bandColours()).toEqual({
      late: PALETTE.late,
      early: PALETTE.early,
      ontime: PALETTE.ontime,
      none: PALETTE.muted,
    });
  });
});

describe("bandTextColours", () => {
  it("swaps only early for the darker green", () => {
    stubTokens({});
    expect(bandTextColours()).toEqual({ ...bandColours(), early: PALETTE["early-strong"] });
  });
});

describe("escapeHtml", () => {
  it("escapes the characters that would break popup HTML", () => {
    expect(escapeHtml(`<a href="x">Fish & Chips</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Fish &amp; Chips&lt;/a&gt;",
    );
  });

  it("leaves plain text alone", () => {
    expect(escapeHtml("Britomart Train Station")).toBe("Britomart Train Station");
  });
});
