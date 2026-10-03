// A route's own colour (AT's `route_color` where it publishes a real one, else
// its mode's), and the one colour every single route's line is drawn in.

import { MODE_ICON_HEX, modeOrBus } from "@/lib/mode";
import { PALETTE } from "@/lib/palette";

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
 * A route's own colour, for its icon and its line on the live map (where every
 * route is drawn at once and the colours tell them apart): AT's `route_color`,
 * else the route's mode icon colour.
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

/**
 * The line a single route is drawn along (route and stop maps, the route strip,
 * the trip line): Shore for every route, so the delay colours of the stops on it
 * never compete with a route's own green, red or orange.
 */
export const ROUTE_LINE_HEX = PALETTE.shore;

/** {@link ROUTE_LINE_HEX} as an SVG stroke class. */
export const ROUTE_LINE_STROKE = "stroke-at-shore";

/** The stroke class for a detour or off-timetable mark beside a route's line. */
export const DETOUR_STROKE = "stroke-at-commercial";
