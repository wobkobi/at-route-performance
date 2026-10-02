// A route's line colour: AT's `route_color` where it publishes a real one, else
// the colour of the route's mode icon.

import { MODE_ICON_HEX, modeOrBus } from "@/lib/mode";

/** AT's `route_color`: six hex digits, no `#`. */
const HEX_COLOUR = /^[0-9a-f]{6}$/i;

/**
 * A route's `route_color` as a CSS colour, or null when AT published none, a
 * malformed one, or `000000`, which AT's feed uses as "unset" rather than black.
 * @param colour - The raw value, hex without `#`.
 * @returns `#rrggbb`, or null.
 */
export function brandColour(colour: string | null | undefined): string | null {
  return colour && HEX_COLOUR.test(colour) && colour !== "000000" ? `#${colour}` : null;
}

/**
 * The colour a route's line is drawn in, on the map, the route strip and the
 * trip line: AT's `route_color`, else the route's mode icon colour.
 * @param mode - Route mode; anything unrecognised reads as a bus.
 * @param colour - The route's `route_color`, hex without `#`.
 * @returns `#rrggbb`.
 */
export function routeColour(
  mode: string | null | undefined,
  colour: string | null | undefined,
): string {
  return brandColour(colour) ?? MODE_ICON_HEX[modeOrBus(mode)];
}

/** The detour orange's hue, in degrees. */
const DETOUR_HUE = 32;

/**
 * The stroke class for a detour or off-timetable mark beside a route's line, on the route strip
 * and the trip line: the detour orange, or ink on a route whose own colour is near that orange
 * (the Outer Link), where an orange strand beside an orange line reads as the line.
 * Near means a hue within 25 degrees of it on a colour that isn't washed out, so a red line keeps
 * the orange.
 * @param hex - The route's line colour as `#rrggbb`.
 * @returns The class.
 */
export function detourStrokeClass(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d < 0.25) return "stroke-at-commercial";
  const hue =
    max === r
      ? (((g - b) / d + 6) % 6) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60;
  return Math.abs(hue - DETOUR_HUE) < 25 ? "stroke-at-ink" : "stroke-at-commercial";
}
