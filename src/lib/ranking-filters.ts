// src/lib/ranking-filters.ts
// The home page's narrowing filters - time of day, day type and area - as one
// value: read from the URL, carried on links, and applied to ranking rows and
// cancellation lists. Mode, school services and delay direction stay where they
// were (lib/page/filter-params.ts); these sit beside them.

import { isAreaKey, type AreaKey } from "@/lib/geo/areas";
import { routeSlug } from "@/lib/route/slug";
import {
  DAYS_PARAM,
  dayTypeLabel,
  dayTypeOf,
  parseDayType,
  type DayType,
} from "@/lib/time/day-type";
import { nzLocalHour } from "@/lib/time/service-day";
import {
  HOURS_PARAM,
  hourRangeClock,
  hourRangeParam,
  isHourInRange,
  parseHourRange,
  type HourRange,
} from "@/lib/time/time-of-day";

/** The query param holding the areas, a comma list as the Routes page reads it. */
export const AREA_PARAM = "area";

/** The narrowing filters. */
export interface RankingFilters {
  /** A part of the day, or null for all of it. */
  hours: HourRange | null;
  /** A kind of service day, or null for every day. */
  days: DayType | null;
  /** Areas a route must serve at least one of; empty for anywhere. */
  areas: AreaKey[];
}

/** No narrowing at all. */
export const NO_RANKING_FILTERS: RankingFilters = { hours: null, days: null, areas: [] };

/**
 * Read the filters from a page's params. The day type narrows a week or month
 * only: a single day already is one kind of day, so the param is ignored there.
 * @param sp - The page's params.
 * @param sp.hours - `hours`, e.g. `7-9`.
 * @param sp.days - `days`: weekday, sat or sun.
 * @param sp.area - `area`, a comma list of area keys.
 * @param singleDay - Whether the page shows one service day.
 * @returns The filters, each unreadable part dropped.
 */
export function parseRankingFilters(
  sp: { hours?: string; days?: string; area?: string },
  singleDay: boolean,
): RankingFilters {
  return {
    hours: parseHourRange(sp.hours),
    days: singleDay ? null : parseDayType(sp.days),
    areas: [...new Set((sp.area ?? "").split(",").filter(isAreaKey))],
  };
}

/**
 * Whether any filter narrows the rows.
 * @param f - The filters.
 * @returns True when at least one is set.
 */
export function hasRankingFilters(f: RankingFilters): boolean {
  return f.hours !== null || f.days !== null || f.areas.length > 0;
}

/**
 * The params that reproduce the filters, for links to carry.
 * @param f - The filters.
 * @returns Param name to value, unset ones undefined.
 */
export function rankingFilterParams(f: RankingFilters): Record<string, string | undefined> {
  return {
    [HOURS_PARAM]: hourRangeParam(f.hours),
    [DAYS_PARAM]: f.days ?? undefined,
    [AREA_PARAM]: f.areas.length > 0 ? f.areas.join(",") : undefined,
  };
}

/**
 * Whether a route serves one of the chosen areas.
 * @param slug - Route slug.
 * @param areas - The chosen areas; empty matches every route.
 * @param routeAreas - Route slug to the areas it serves.
 * @returns True when the route passes the area filter.
 */
export function inAreas(
  slug: string,
  areas: readonly AreaKey[],
  routeAreas: Readonly<Record<string, readonly AreaKey[]>>,
): boolean {
  return areas.length === 0 || (routeAreas[slug] ?? []).some((a) => areas.includes(a));
}

/**
 * Ranking rows narrowed to the chosen areas.
 * @param rows - Per-route rows.
 * @param areas - The chosen areas; empty keeps every row.
 * @param routeAreas - Route slug to the areas it serves.
 * @returns The rows that pass.
 */
export function rowsInAreas<T extends { route_id: string }>(
  rows: readonly T[],
  areas: readonly AreaKey[],
  routeAreas: Readonly<Record<string, readonly AreaKey[]>>,
): T[] {
  return areas.length === 0
    ? [...rows]
    : rows.filter((r) => inAreas(routeSlug(r.route_id), areas, routeAreas));
}

/** A cancelled trip, as far as the filters read it. */
export interface FilterableCancellation {
  /** Route slug. */
  route_id: string;
  mode: string;
  school: boolean;
  service_date: string;
  /** ISO instant the trip was due to start, or null when it cannot be told. */
  scheduled_start: string | null;
}

/**
 * Whether a cancelled trip passes the filters. A trip is placed in the day by
 * its scheduled start, as its rider-wait penalty is; one whose start cannot be
 * told fails any time-of-day filter, since there is no saying it belongs.
 * @param trip - The cancelled trip.
 * @param f - The filters.
 * @param routeAreas - Route slug to the areas it serves.
 * @returns True when it counts under the filters.
 */
export function cancellationMatches(
  trip: FilterableCancellation,
  f: RankingFilters,
  routeAreas: Readonly<Record<string, readonly AreaKey[]>>,
): boolean {
  if (f.days && dayTypeOf(trip.service_date) !== f.days) return false;
  if (f.hours) {
    if (!trip.scheduled_start) return false;
    if (!isHourInRange(nzLocalHour(new Date(trip.scheduled_start)), f.hours)) return false;
  }
  return inAreas(trip.route_id, f.areas, routeAreas);
}

/**
 * A route link's query with the part of the day added, so a route opened from a
 * narrowed board opens on the same hours (the route page reads `hours` too).
 * @param query - The query from routeLinkQuery, with its `?`, or empty.
 * @param hours - The part of the day, or null for all of it.
 * @returns The query with `hours` added when set.
 */
export function routeQueryWithHours(query: string, hours: HourRange | null): string {
  const param = hourRangeParam(hours);
  if (!param) return query;
  return `${query}${query ? "&" : "?"}${HOURS_PARAM}=${param}`;
}

/**
 * The active filters in words, for the note under the verdict.
 * @param f - The filters.
 * @param areaLabels - The chosen areas' labels, in display order.
 * @param live - Whether the window is the day still under way, so a range
 *   running to the day's end reads "to now".
 * @returns E.g. "7am to 9am, Saturdays, North Shore", or null with none set.
 */
export function rankingFiltersPhrase(
  f: RankingFilters,
  areaLabels: readonly string[],
  live: boolean,
): string | null {
  const parts = [
    f.hours ? hourRangeClock(f.hours, live) : null,
    f.days ? dayTypeLabel(f.days) : null,
    ...areaLabels,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Which parts of the page the filters leave whole, if any. On the day view
 * the worst-of cards and the vehicle counts follow the time of day but not the
 * area, which their boards have no filter for; on a week or month they follow
 * neither.
 * @param filters - The active filters.
 * @param window - The window shown.
 * @returns The sentence after the phrase.
 */
export function rankingFiltersReach(
  filters: RankingFilters,
  window: "day" | "week" | "month",
): string {
  if (window !== "day") {
    return `The figures, the cancellations and the route rankings follow it; the worst-of cards and the vehicle counts cover the whole ${window}.`;
  }
  if (filters.areas.length === 0) return "Everything on the page follows it.";
  const cover = filters.hours ? "follow the time of day but cover every area" : "cover every area";
  return `The figures, the cancellations and the route rankings follow it; the worst-of cards and the vehicle counts ${cover}.`;
}
