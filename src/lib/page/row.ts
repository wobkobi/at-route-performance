// src/lib/page/row.ts
// The row layout the lists share: every list of trips (the shame board's trip
// rows, its cancelled rows and the /cancellations list) and the rank and route
// name of every route row, so a reader crossing between lists reads one row.

/**
 * A row's rank number. Wide enough for two digits, right-aligned so 9 and 10
 * line up; the size comes from the row.
 */
export const RANK_CLASS = "w-6 shrink-0 text-right text-at-muted tabular-nums";

/**
 * A route's name in a list row: ink, turning Shore with the row's hover. The
 * row's link carries `group`, since the whole row is the link.
 */
export const ROUTE_NAME_CLASS = "font-semibold text-at-ink group-hover:text-at-shore";

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
 * The 10rem floor is what pushes the badges onto a second line: a `flex-1` item
 * has a zero flex basis, so without a floor it would simply shrink and nothing
 * would ever wrap. The floor is capped at the group's own width, since on a 360px
 * phone the group can be narrower than 10rem and a bare floor then spilled the
 * name over the delay beside it. Truncation handles a headsign too long for a row.
 */
export const TRIP_NAME_CLASS = "min-w-[min(10rem,100%)] flex-1 truncate";
