// src/components/ModeIcon.tsx
// The transport-mode icon, one colour per mode.

import { cn } from "@/lib/cn";
import { MODE_ICON_CLASS, MODE_ICON_HEX, MODE_NAME, modeOrBus } from "@/lib/mode";
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
 * its mode's colour. The shared-link card and both maps draw from this too, so
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
  const m = modeOrBus(mode);
  const colour = { colourClass: MODE_ICON_CLASS[m], hex: MODE_ICON_HEX[m] };
  if (m === "TRAIN") return { Icon: FaSubway, ...colour, label: MODE_NAME.TRAIN };
  if (m === "FERRY") return { Icon: FaShip, ...colour, label: MODE_NAME.FERRY };
  if (isSchoolBus(shortName, longName)) return { Icon: FaBus, ...colour, label: "School bus" };
  return { Icon: FaBusAlt, ...colour, label: MODE_NAME.BUS };
}

/**
 * Transport-mode glyph drawn next to a route number: a bus, school bus, train
 * or ferry, in its mode's colour.
 * @param props - Component props.
 * @param props.mode - Route mode.
 * @param props.shortName - Route short name (code).
 * @param props.longName - Route long name.
 * @param props.className - Extra classes; overrides the default `h-5 w-5` size.
 * @param props.decorative - Hide the icon from assistive tech.
 * @returns The mode icon.
 */
export function ModeIcon({
  mode,
  shortName,
  longName,
  className,
  decorative = false,
}: ModeIconProps): JSX.Element {
  const { Icon, colourClass, label } = modeGlyph(mode, shortName, longName);
  return (
    <Icon
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
      className={cn("h-5 w-5 shrink-0", colourClass, className)}
    />
  );
}
