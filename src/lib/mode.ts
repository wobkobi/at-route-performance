// src/lib/mode.ts
// Transport modes: the one list, parser and set of labels every page reads.

import { PALETTE } from "@/lib/palette";

/** Every transport mode, in the order the site lists them. */
export const MODES = ["BUS", "TRAIN", "FERRY"] as const;

/** One transport mode. */
export type Mode = (typeof MODES)[number];

/**
 * Whether a value names a mode.
 * @param value - Any value, typically a query param or a stored field.
 * @returns True when `value` is one of {@link MODES}.
 */
export function isMode(value: unknown): value is Mode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

/**
 * Parse a `?mode=` value. Anything that is not a mode reads as no filter.
 * @param value - The raw param.
 * @returns The mode, or null for all modes.
 */
export function parseMode(value: string | null | undefined): Mode | null {
  return isMode(value) ? value : null;
}

/**
 * A stored mode, with anything unrecognised read as a bus: the same default the
 * static feed's route-type mapping falls back to.
 * @param value - The stored value, or null when the route is missing.
 * @returns The mode.
 */
export function modeOrBus(value: string | null | undefined): Mode {
  return parseMode(value) ?? "BUS";
}

/** Singular name per mode, capitalised ("Bus"). */
export const MODE_NAME: Record<Mode, string> = { BUS: "Bus", TRAIN: "Train", FERRY: "Ferry" };

/** Plural service noun per mode, capitalised ("Buses"). */
export const MODE_NOUN: Record<Mode, string> = { BUS: "Buses", TRAIN: "Trains", FERRY: "Ferries" };

/**
 * A mode as a lower-case word for running prose ("bus", "buses").
 * @param mode - The mode.
 * @param plural - Whether to give the plural noun.
 * @returns The lower-case word.
 */
export function modeWord(mode: Mode, plural = false): string {
  return (plural ? MODE_NOUN : MODE_NAME)[mode].toLowerCase();
}

/**
 * Each mode's icon colour as a text class: one colour per mode, whatever the
 * route. Bus and train share AT Shore blue and are told apart by their glyphs;
 * ferry takes greeny-bluey.
 */
export const MODE_ICON_CLASS: Record<Mode, string> = {
  BUS: "text-at-shore",
  TRAIN: "text-at-shore",
  FERRY: "text-at-greeny-bluey",
};

/** {@link MODE_ICON_CLASS} as hex, for the shared-link card and map lines. */
export const MODE_ICON_HEX: Record<Mode, string> = {
  BUS: PALETTE.shore,
  TRAIN: PALETTE.shore,
  FERRY: PALETTE["greeny-bluey"],
};
