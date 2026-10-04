// A route's own colour (AT's `route_color` where it publishes one, else its
// service's brand colour, else its mode's), and the one colour every single
// route's line is drawn in.

import { MODE_ICON_HEX, modeOrBus } from "@/lib/mode";
import { PALETTE } from "@/lib/palette";

/** AT's `route_color`: six hex digits, no `#`. */
const HEX_COLOUR = /^[0-9a-f]{6}$/i;

/**
 * Brand colours for branded services AT's feed leaves uncoloured, by short
 * name. The express and Airport services take the colours they are drawn in on
 * the AT Metro wiki; RBM, the Meadowbank loop feeding the Eastern Line's rail
 * bus, takes RBE's Eastern yellow. AT's own `route_color` wins once it
 * publishes one.
 */
const SERVICE_COLOUR: Readonly<Record<string, string>> = {
  NX1: "143F90",
  NX2: "00A6B6",
  WX1: "00843C",
  AIR: "F7941E",
  RBM: "FDB913",
};

/**
 * A route's own colour as a CSS colour: AT's `route_color`, else the brand
 * colour of a service AT leaves uncoloured, else null. Black is a real colour
 * here: AT leaves an unset route's field empty, and gives its black routes (the
 * Rakino, Rangitoto and Tiritiri ferries among them) white text to go with it.
 * @param colour - AT's raw value, hex without `#`.
 * @param shortName - The route's short name (its code), for the brand colours.
 * @returns `#rrggbb`, or null.
 */
export function brandColour(
  colour: string | null | undefined,
  shortName?: string | null,
): string | null {
  if (colour && HEX_COLOUR.test(colour)) return `#${colour}`;
  const own = shortName ? SERVICE_COLOUR[shortName] : undefined;
  return own ? `#${own}` : null;
}

/**
 * A route's own colour, for its icon and its line on the live map (where every
 * route is drawn at once and the colours tell them apart): its
 * {@link brandColour}, else the route's mode icon colour.
 * @param mode - Route mode; anything unrecognised reads as a bus.
 * @param colour - The route's `route_color`, hex without `#`.
 * @param shortName - The route's short name (its code).
 * @returns `#rrggbb`.
 */
export function routeColour(
  mode: string | null | undefined,
  colour: string | null | undefined,
  shortName?: string | null,
): string {
  return brandColour(colour, shortName) ?? MODE_ICON_HEX[modeOrBus(mode)];
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
