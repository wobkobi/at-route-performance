// src/lib/copy.ts
// Strings that appear on more than one surface. A name or a caveat with several
// copies drifts, and the drift reaches a reader before it reaches a reviewer.

/**
 * The site's name, for the masthead, the footer lockup, the tab title and the
 * share cards.
 *
 * "AT" stays abbreviated on purpose. The data is Auckland Transport's and the
 * abbreviation credits it, but the site is not theirs - the footer says as much -
 * so expanding it here would claim more than is true.
 */
export const SITE_NAME = "AT Route Performance";

/**
 * Who chose the on-time window, for every surface that states its bounds.
 *
 * Auckland Transport publishes the schedule; the window a run is judged against
 * is this site's own. Stated bare, under an AT logo and a "Data (c) Auckland
 * Transport" footer, it reads as AT's own standard, which would put a number
 * in AT's mouth that AT never said. README.md has always drawn the line; no
 * surface a reader sees ever did.
 */
export const ON_TIME_WINDOW_NOTE = "That window is this site's choice, not AT's.";

/**
 * The trailing clause of a page description, naming whose schedule and whose
 * threshold in the one breath that used to name only the schedule.
 *
 * Pairs with {@link ON_TIME_WINDOW_NOTE}: this is the short form for metadata,
 * where a description is also the share card's subtitle and a search snippet.
 */
export const MEASURED_AGAINST =
  "against Auckland Transport's published schedule, on this site's own on-time window.";

/**
 * What a "day" means on every page that shows one.
 *
 * The 4am boundary decides which day a 1am run is counted in, which is the
 * difference between a late-night service reading as tonight's failure or
 * yesterday's. It was explained only in the day stepper's `title`, so a phone -
 * where there is no hover at all - had no way to ask. Stated in the footer,
 * which is on every page; the stepper keeps its own dated version for a reader
 * who does hover.
 */
export const SERVICE_DAY_NOTE =
  "A service day runs 4am to 4am, so a run after midnight counts toward the day before.";
