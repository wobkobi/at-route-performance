// src/lib/link-colour.ts
/**
 * @description Map AT Link service names to their Tailwind background colour utility.
 */

/**
 * Map of normalised AT Link service names to their Tailwind background utility.
 * Colours are the actual RAL paint hex from the bus-services design guide (p8),
 * exposed as `--color-link-*` tokens in globals.css.
 */
const LINK_CLASSES: Record<string, string> = {
  citylink: "bg-link-city",
  innerlink: "bg-link-inner",
  outerlink: "bg-link-outer",
  waihekelink: "bg-link-waiheke",
  airportlink: "bg-link-airport",
  tamakilink: "bg-link-tamaki",
};

/** Combining diacritical marks (e.g. macrons), stripped after NFD normalisation. */
const COMBINING_MARKS = /\p{Diacritic}/gu;

/**
 * Resolve the Link-service colour class for a route from its names.
 * Strips macrons and whitespace so "TamakiLink" and "Tamaki Link" both match.
 * @param names - Candidate names (e.g. short and long route names); nullables ignored.
 * @returns A `bg-link-*` Tailwind class, or null when the route is not a Link service.
 */
export function linkColour(...names: Array<string | null | undefined>): string | null {
  const haystack = names
    .filter((n): n is string => Boolean(n))
    .join(" ")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/\s+/g, "");

  for (const [key, cls] of Object.entries(LINK_CLASSES)) {
    if (haystack.includes(key)) return cls;
  }
  return null;
}
