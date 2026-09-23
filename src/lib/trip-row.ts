// src/lib/trip-row.ts
// The row layout every list of trips shares - the shame board's run rows, its
// cancelled rows and the /cancellations list - so the three line their columns up
// and a reader crossing between them reads the same row.

/** The list item: a rule above every row but the first. */
export const TRIP_ROW_CLASS = "border-t border-at-border first:border-0";

/**
 * The link filling the row. It is the whole row, not just the name, so a thumb
 * landing on the time, a badge, the value or the chevron opens the trip. The
 * negative margin lets the hover tint reach the container's padding edge.
 */
export const TRIP_ROW_LINK_CLASS =
  "-mx-4 flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-at-shore-pale";

/**
 * Name and badges share a wrapping line. Every badge is `shrink-0`, so with them
 * all as siblings of the name the name was the only column that could give, and a
 * cancelled run truncated to "32 to Manger...". Here a badge that will not fit
 * drops under the name instead, while the value and the chevron stay to the right.
 */
export const TRIP_NAME_GROUP_CLASS = "flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1";

/**
 * `min-w-40` is what pushes the badges onto a second line: a `flex-1` item has a
 * zero flex basis, so without a floor it would simply shrink and nothing would
 * ever wrap. Truncation is still there for a headsign too long for a full row.
 */
export const TRIP_NAME_CLASS = "min-w-40 flex-1 truncate";
