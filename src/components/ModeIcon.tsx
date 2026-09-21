// src/components/ModeIcon.tsx
// Render the transport-mode icon in the route's colour from the AT API.

import { cn } from "@/lib/cn";
import { isSchoolBus } from "@/lib/school-bus";
import type { JSX } from "react";
import type { IconType } from "react-icons";
import { FaBus, FaBusAlt, FaShip, FaSubway } from "react-icons/fa";

/** AT's `route_color`: six hex digits, no `#`. */
const HEX_COLOUR = /^[0-9a-f]{6}$/i;

/**
 * Branded-service short code to its Tailwind text colour, for when the AT API
 * publishes no `route_color` for the route. The six Link liveries use their
 * official RAL colours (AT bus services design guide p8, exposed as
 * `--color-link-*`); rapid express services (NX/WX) aren't in the livery guide,
 * so they take AT's lighter Shore. Spelt out as literals so Tailwind generates
 * the text utilities. Keyed by the route's short name (which is the code).
 */
const SERVICE_COLOUR: Record<string, string> = {
  CTY: "text-link-city", // CityLink - Traffic Red
  INN: "text-link-inner", // InnerLink - Yellow Green
  OUT: "text-link-outer", // OuterLink - Melon Yellow
  TMK: "text-link-tamaki", // TamakiLink - blue
  AIR: "text-link-airport", // AirportLink - amber
  WHK: "text-link-waiheke", // WaihekeLink - pastel turquoise
  NX1: "text-at-shore-light", // Northern Express (rapid)
  NX2: "text-at-shore-light",
  WX1: "text-at-shore-light", // Western Express (rapid)
};

/** Props for {@link ModeIcon}. */
export interface ModeIconProps {
  /** Route mode ("BUS" | "TRAIN" | "FERRY"). */
  mode: string;
  /** Route short name (the code), for service colour + school detection. */
  shortName?: string | null;
  /** Route long name, where the school `S###` code can live. */
  longName?: string | null;
  /** Extra classes; size defaults to `h-5 w-5`. */
  className?: string;
  /** The route's `route_color` from the AT API (hex, no `#`); used as-is when set. */
  colour?: string | null;
}

/** The glyph, fallback colour class and spoken label a route's icon uses. */
export interface ModeGlyph {
  Icon: IconType;
  colourClass: string;
  label: string;
}

/**
 * Pick a route's glyph and fallback colour: a school bus in magenta, trains and
 * ferries in their mode token, other buses in their branded service colour
 * (see {@link SERVICE_COLOUR}) or AT Shore blue. The shared-link card draws
 * its badge from this too, so the two cannot pick different icons.
 * @param mode - Route mode.
 * @param shortName - Route short name (code).
 * @param longName - Route long name.
 * @returns The glyph, its colour class and its label.
 */
export function modeGlyph(
  mode: string,
  shortName?: string | null,
  longName?: string | null,
): ModeGlyph {
  if (mode === "BUS" && isSchoolBus(shortName, longName)) {
    return { Icon: FaBus, colourClass: "text-at-disruption", label: "School bus" };
  }
  if (mode === "TRAIN") return { Icon: FaSubway, colourClass: "text-at-cosmic", label: "Train" };
  if (mode === "FERRY") {
    return { Icon: FaShip, colourClass: "text-at-greeny-bluey", label: "Ferry" };
  }
  return {
    Icon: FaBusAlt,
    colourClass: SERVICE_COLOUR[(shortName ?? "").toUpperCase()] ?? "text-at-shore",
    label: "Bus",
  };
}

/**
 * A route's `route_color` as a CSS colour, or null when AT published none or a
 * malformed one (the browser would drop it, leaving the glyph uncoloured).
 * @param colour - The raw value, hex without `#`.
 * @returns `#rrggbb`, or null.
 */
export function brandColour(colour: string | null | undefined): string | null {
  return colour && HEX_COLOUR.test(colour) ? `#${colour}` : null;
}

/**
 * Transport-mode glyph drawn next to a route number: a bus, train, ferry, or
 * (magenta) school bus. When the AT API publishes a `route_color` for the route
 * it is used exactly as given, via an inline style so Tailwind's purge doesn't
 * need to know the value. Only routes without one fall back: buses to their
 * branded service colour (see {@link SERVICE_COLOUR}) or AT Shore blue, trains
 * and ferries to their mode token.
 * @param props - Component props.
 * @param props.mode - Route mode.
 * @param props.shortName - Route short name (code).
 * @param props.longName - Route long name.
 * @param props.className - Extra classes; overrides the default `h-5 w-5` size.
 * @param props.colour - The route's `route_color` from the AT API, hex without `#`.
 * @returns The mode icon.
 */
export function ModeIcon({
  mode,
  shortName,
  longName,
  className,
  colour,
}: ModeIconProps): JSX.Element {
  const { Icon, colourClass, label } = modeGlyph(mode, shortName, longName);
  const brand = brandColour(colour);
  return (
    <Icon
      role="img"
      aria-label={label}
      className={cn("h-5 w-5 shrink-0", brand ? undefined : colourClass, className)}
      style={brand ? { color: brand } : undefined}
    />
  );
}
