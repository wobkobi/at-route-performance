// src/lib/delay-colour.ts
import { delayBand } from "@/lib/on-time";

/** Deviation in minutes at which a stop's colour reaches full strength. */
const FULL_AT_MIN = 8;

/**
 * Floor so a near-on-time stop's hue stays clearly coloured (not washed to a pale,
 * grey-looking tint against the light surface/basemap). The fade then only spans
 * `[MIN_STRENGTH, 1]`, keeping every stop legibly coloured while a more-off stop
 * still reads as stronger.
 */
const MIN_STRENGTH = 0.6;

/**
 * How strongly to paint a stop's colour (0..1) by how far off schedule it ran: a
 * stop a minute off is faint, one ten-plus minutes off is full strength. Lets the
 * map and the line diagram fade a stop the same way, per minute of lateness or
 * earliness.
 * @param delaySec - Signed deviation in seconds.
 * @returns Colour strength in `[MIN_STRENGTH, 1]`.
 */
export function delayStrength(delaySec: number): number {
  const mins = Math.abs(delaySec) / 60;
  return Math.min(1, MIN_STRENGTH + (1 - MIN_STRENGTH) * (mins / FULL_AT_MIN));
}

/** A stop's on-time band token, or null when there is no data. */
export type DelayBandToken = "late" | "early" | "ontime";

/**
 * The on-time band token for a deviation (`late` / `early` / `ontime`), or null
 * when there is no data - the hue shared by the map markers and diagram nodes.
 * @param delaySec - Signed deviation in seconds, or null.
 * @param mode - Route mode (drives the asymmetric on-time window).
 * @returns The band token, or null.
 */
export function delayBandToken(delaySec: number | null, mode: string): DelayBandToken | null {
  if (delaySec == null) return null;
  const band = delayBand(delaySec, mode);
  return band === "late" ? "late" : band === "early" ? "early" : "ontime";
}

/**
 * The AT status palette as RGB triples (mirrors globals.css; there is no dark
 * theme). Hard-coded so the colour is a concrete `rgb(...)` - valid in both an
 * SVG `stroke`/`fill` attribute and a Leaflet marker, unlike `color-mix(...)`.
 */
const HUE: Record<DelayBandToken, [number, number, number]> = {
  late: [222, 10, 43], // #de0a2b
  early: [149, 193, 31], // #95c11f
  ontime: [0, 115, 189], // #0073bd
};
/** Page surface the hue fades toward (#ffffff). */
const SURFACE: [number, number, number] = [255, 255, 255];
/** Neutral colour for a stop with no data (#d1d6da). */
const NO_DATA = "rgb(209, 214, 218)";

/**
 * A faded colour for a stop: its band hue mixed toward the page surface by how
 * far off schedule it ran (more off = stronger), as a concrete `rgb(...)`. No
 * data reads as the neutral border. Shared by the diagram node ring and the map
 * markers so the two always agree.
 * @param delaySec - Signed deviation in seconds, or null.
 * @param mode - Route mode (drives the asymmetric on-time window).
 * @returns An `rgb(...)` colour string.
 */
export function delayColour(delaySec: number | null, mode: string): string {
  const token = delayBandToken(delaySec, mode);
  if (token == null) return NO_DATA;
  const t = delayStrength(delaySec as number);
  const [r, g, b] = HUE[token];
  const [sr, sg, sb] = SURFACE;
  return `rgb(${Math.round(sr + (r - sr) * t)}, ${Math.round(sg + (g - sg) * t)}, ${Math.round(sb + (b - sb) * t)})`;
}
