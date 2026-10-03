// src/components/ModeIcon.tsx
// The transport-mode icon, in the route's own colour where AT gives it one and
// its mode's colour otherwise.

import { cn } from "@/lib/cn";
import { MODE_ICON_CLASS, MODE_ICON_HEX, MODE_NAME, modeOrBus, type Mode } from "@/lib/mode";
import { brandColour } from "@/lib/route/colour";
import { isSchoolBus } from "@/lib/school-bus";
import type { JSX } from "react";
import type { IconType } from "react-icons";
import { FaBus, FaBusAlt, FaShip, FaSubway } from "react-icons/fa";

/** Props for {@link ModeIcon}. */
export interface ModeIconProps {
  /** Route mode; anything unrecognised reads as a bus. */
  mode: string;
  /** Route short name (the code), for school detection. */
  shortName?: string | null;
  /** Route long name, where the school `S###` code can live. */
  longName?: string | null;
  /** The route's `route_color` (hex, no `#`); absent or unset draws the mode's colour. */
  colour?: string | null;
  /** Extra classes; size defaults to `h-5 w-5`. */
  className?: string;
  /** Hide the icon from assistive tech, for one beside text that already names the mode. */
  decorative?: boolean;
}

/** The glyph, colour and spoken label a route's icon uses. */
export interface ModeGlyph {
  Icon: IconType;
  /** The mode's text colour class. */
  colourClass: string;
  /** The same colour as hex, for a surface that reads no CSS. */
  hex: string;
  label: string;
}

/**
 * Pick a route's glyph: a school bus, other buses, a train or a ferry, each in
 * its mode's colour ({@link ModeIcon} swaps in the route's own where it has one). The shared-link card and both maps draw from this too, so
 * none can pick a different icon.
 * @param mode - Route mode.
 * @param shortName - Route short name (code).
 * @param longName - Route long name.
 * @returns The glyph, its colour and its label.
 */
export function modeGlyph(
  mode: string,
  shortName?: string | null,
  longName?: string | null,
): ModeGlyph {
  return glyphFor(modeOrBus(mode), isSchoolBus(shortName, longName));
}

/**
 * The glyph for a mode once school-ness is known, for a caller holding a flag
 * rather than the route's names (a live vehicle, a map). {@link modeGlyph} reads
 * the flag from the names.
 * @param mode - Route mode.
 * @param school - Whether the route is a school service; only a bus takes it.
 * @returns The glyph, its colour and its label.
 */
export function glyphFor(mode: Mode, school: boolean): ModeGlyph {
  const colour = { colourClass: MODE_ICON_CLASS[mode], hex: MODE_ICON_HEX[mode] };
  if (mode === "TRAIN") return { Icon: FaSubway, ...colour, label: MODE_NAME.TRAIN };
  if (mode === "FERRY") return { Icon: FaShip, ...colour, label: MODE_NAME.FERRY };
  if (school) return { Icon: FaBus, ...colour, label: "School bus" };
  return { Icon: FaBusAlt, ...colour, label: MODE_NAME.BUS };
}

/** Every glyph a route can take, once each, for the maps to copy their SVG from. */
export const ALL_GLYPHS: readonly ModeGlyph[] = [
  glyphFor("BUS", false),
  glyphFor("BUS", true),
  glyphFor("TRAIN", false),
  glyphFor("FERRY", false),
];

/**
 * Transport-mode glyph drawn next to a route number: a bus, school bus, train
 * or ferry, in the route's own colour (a train line's, a Link's), else its mode's.
 * @param props - Component props.
 * @param props.mode - Route mode.
 * @param props.shortName - Route short name (code).
 * @param props.longName - Route long name.
 * @param props.colour - The route's `route_color`, or none for the mode's colour.
 * @param props.className - Extra classes; overrides the default `h-5 w-5` size.
 * @param props.decorative - Hide the icon from assistive tech.
 * @returns The mode icon.
 */
export function ModeIcon({
  mode,
  shortName,
  longName,
  colour,
  className,
  decorative = false,
}: ModeIconProps): JSX.Element {
  const { Icon, colourClass, label } = modeGlyph(mode, shortName, longName);
  const own = brandColour(colour);
  return (
    <Icon
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
      className={cn("h-5 w-5 shrink-0", !own && colourClass, className)}
      style={own ? { color: own } : undefined}
    />
  );
}
