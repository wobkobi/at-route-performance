// src/lib/map/style.ts
// Leaflet draws on canvas and SVG outside React, so the maps read their colours
// from the CSS tokens and write popup HTML by hand. The helpers both maps share.

import type { ReadingBand } from "@/lib/on-time";
import { PALETTE } from "@/lib/palette";

/**
 * Resolve a CSS custom property on the document root to its concrete value,
 * since canvas and SVG marks take a colour value rather than a class.
 * @param name - Custom property name, e.g. "--color-at-late".
 * @returns The trimmed computed value, or "" when the property is unset.
 */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Escape HTML special characters in feed strings before they go into popup HTML.
 * @param s - Raw string from external data.
 * @returns HTML-safe string.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A live vehicle's mark colour for each reading band. Dots and rings are filled
 * marks, so early takes the bright green the site's other filled marks use (the
 * darker green is for text and thin lines); no reading stays muted so it never
 * reads as on time. The palette backs each token for a page whose stylesheet has
 * not applied.
 * @returns Colour per band.
 */
export function bandColours(): Record<ReadingBand, string> {
  return {
    late: cssVar("--color-at-late") || PALETTE.late,
    early: cssVar("--color-at-early") || PALETTE.early,
    ontime: cssVar("--color-at-ontime") || PALETTE.ontime,
    none: cssVar("--color-at-muted") || PALETTE.muted,
  };
}

/**
 * A reading band's colour for a glyph or text drawn on white. The same as
 * {@link bandColours} but for early, whose bright green is too pale for a glyph
 * and takes the darker green the site's early text uses.
 * @returns Colour per band.
 */
export function bandTextColours(): Record<ReadingBand, string> {
  return {
    ...bandColours(),
    early: cssVar("--color-at-early-strong") || PALETTE["early-strong"],
  };
}
