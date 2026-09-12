// src/lib/brand-colour.ts
// Decide whether a route's brand colour from the AT feed is legible
// on the page surface. AT publishes `route_color` for its own maps and printed
// material, not for a white web page: the Eastern Line's yellow (`FDB913`) sits
// at about 1.7:1 against `--color-at-surface`, well under the 3:1 minimum for a
// meaningful non-text graphic, and Te Huia ships pure black. New City Rail Link
// lines arrive with new colours in September 2026, so this cannot be a hard-coded
// exception list - it measures instead.

/** Page surface the icons sit on (`--color-at-surface` in globals.css). */
const SURFACE_LUMINANCE = 1;

/**
 * Minimum contrast ratio for a non-text graphic to read clearly (WCAG 1.4.11).
 */
const MIN_CONTRAST = 3;

/**
 * One channel's contribution to relative luminance, sRGB-linearised.
 * @param channel - Channel value in 0..255.
 * @returns The linearised channel in 0..1.
 */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Relative luminance of a six-digit hex colour, per WCAG.
 * @param hex - Six hex digits, no leading `#`.
 * @returns Relative luminance in 0..1, or null when the input isn't a hex triple.
 */
export function relativeLuminance(hex: string): number | null {
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  const r = linearise(parseInt(hex.slice(0, 2), 16));
  const g = linearise(parseInt(hex.slice(2, 4), 16));
  const b = linearise(parseInt(hex.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Whether a feed colour is legible enough to use as a glyph on the page surface.
 *
 * Callers fall back to the mode's own token when this is false, so a route keeps
 * a visible icon rather than a technically-correct invisible one.
 * @param hex - AT's `route_color`, six hex digits without `#`, or null.
 * @returns True when the colour clears {@link MIN_CONTRAST} against the surface.
 */
export function isLegibleOnSurface(hex: string | null | undefined): boolean {
  if (!hex) return false;
  const luminance = relativeLuminance(hex);
  if (luminance === null) return false;
  const ratio =
    (Math.max(SURFACE_LUMINANCE, luminance) + 0.05) /
    (Math.min(SURFACE_LUMINANCE, luminance) + 0.05);
  return ratio >= MIN_CONTRAST;
}
