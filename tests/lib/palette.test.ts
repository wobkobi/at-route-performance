// tests/lib/palette.test.ts
// The script-side palette must match the CSS tokens it mirrors.
import { hexRgb, isPaletteKey, PALETTE } from "@/lib/palette";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every `--color-at-<key>: #rrggbb;` declaration in globals.css.
 * @returns Token key to lower-case hex.
 */
function cssTokens(): Record<string, string> {
  const css = readFileSync("src/app/globals.css", "utf8");
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--color-at-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    out[m[1]!] = m[2]!.toLowerCase();
  }
  return out;
}

describe("PALETTE", () => {
  it("holds exactly the --color-at-* tokens globals.css declares", () => {
    expect({ ...PALETTE }).toEqual(cssTokens());
  });
});

describe("isPaletteKey", () => {
  it("knows the tokens and nothing else", () => {
    expect(isPaletteKey("shore")).toBe(true);
    expect(isPaletteKey("early-strong")).toBe(true);
    expect(isPaletteKey("toString")).toBe(false);
    expect(isPaletteKey("link-city")).toBe(false);
  });
});

describe("hexRgb", () => {
  it("splits a hex colour into its channels", () => {
    expect(hexRgb("#de0a2b")).toEqual([222, 10, 43]);
    expect(hexRgb(PALETTE.surface)).toEqual([255, 255, 255]);
  });
});
