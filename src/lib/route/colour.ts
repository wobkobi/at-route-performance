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
