// The site's `--color-at-*` tokens as hex, for surfaces that read no CSS: the
// shared-link card (Satori), Leaflet markers and colours mixed in script. A test
// holds this table to globals.css, so the two cannot drift.

/** Each `--color-at-<key>` token's hex. */
export const PALETTE = {
  shore: "#0073bd",
  ocean: "#001930",
  safety: "#ffdd00",
  "bright-green": "#95c11f",
  "shore-light": "#00a7e5",
  commercial: "#f7941f",
  disruption: "#ca0076",
  "greeny-bluey": "#009985",
  cosmic: "#773581",
  "anther-red": "#de0a2b",
  ink: "#001930",
  muted: "#667583",
  border: "#d1d6da",
  bg: "#e9edf1",
  surface: "#ffffff",
  "shore-pale": "#ebf5fb",
  stripe: "#f4f6f8",
  ontime: "#0073bd",
  late: "#de0a2b",
  early: "#95c11f",
  "early-strong": "#5b7a12",
} as const;

/** A palette token, the part of `--color-at-<key>` after the prefix. */
export type PaletteKey = keyof typeof PALETTE;

/**
 * Whether a string names a palette token.
 * @param key - A candidate token name.
 * @returns True when `key` is a {@link PALETTE} key.
 */
export function isPaletteKey(key: string): key is PaletteKey {
  return Object.hasOwn(PALETTE, key);
}

/**
 * A `#rrggbb` colour as its red, green and blue channels.
 * @param hex - The colour, with its `#`.
 * @returns The three channels, 0-255.
 */
export function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
