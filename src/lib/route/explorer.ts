// src/lib/route/explorer.ts
// Filters and sorts for the Routes page. Pure, so the page can run them on the
// client as the reader changes a control and the tests can pin them down. The
// filters round-trip through the query string, writing only what differs from
// the defaults, so a filtered view is a shareable link.
import { type AreaKey, isAreaKey } from "@/lib/geo/areas";
import { type FareZoneKey, isFareZoneKey } from "@/lib/geo/fare-zones";
import { type Mode, parseMode } from "@/lib/mode";
import { flipDir, type SortDir } from "@/lib/page/table-sort";
import {
  type DelayDirection,
  MIN_BOARD_EVENTS,
  MIN_MODE_EVENTS,
  parseDelayDirection,
} from "@/lib/rankings";
import { lineName } from "@/lib/route/line-name";
import { compareRouteNumbers, routeDisplayName } from "@/lib/route/slug";
import {
  parseSchoolFilter,
  schoolAllows,
  type SchoolFilter,
  schoolFilterParam,
} from "@/lib/school-bus";
import type { RouteRow } from "@/types/api";

/** One route on the Routes page: its window stats plus what the filters need. */
export interface ExplorerRoute extends RouteRow {
  /** Version-stripped route slug, for links and joins. */
  slug: string;
  /** Areas the route served over the last week of completed days. */
  areas: AreaKey[];
  /** Fare zones its stops were in over the same week. */
  zones: FareZoneKey[];
  /** Trips cancelled in the window. */
  cancelled: number;
  /** Whether the route is a school service. */
  school: boolean;
  /** Slug of the operator that runs it, or null when none is recorded. */
  operator: string | null;
}

/** A sortable measure. */
export type ExplorerSort =
  "route" | "ontime" | "off" | "delay" | "late" | "early" | "arrivals" | "cancelled";

/** Every sort with its label and the direction it opens in (the more telling end first). */
export const EXPLORER_SORTS: ReadonlyArray<{ key: ExplorerSort; label: string; dir: SortDir }> = [
  { key: "route", label: "Route number", dir: "asc" },
  { key: "ontime", label: "On time %", dir: "desc" },
  { key: "off", label: "Avg off by", dir: "desc" },
  { key: "delay", label: "Early or late", dir: "desc" },
  { key: "late", label: "Late %", dir: "desc" },
  { key: "early", label: "Early %", dir: "desc" },
  { key: "arrivals", label: "Arrivals", dir: "desc" },
  { key: "cancelled", label: "Cancellations", dir: "desc" },
];

/** The Routes page's filter and sort state. */
export interface ExplorerFilters {
  /** Free-text search over route number and name. */
  q: string;
  mode: Mode | null;
  /** Areas to match; a route matches when it serves any of them. Empty matches every route. */
  areas: AreaKey[];
  /** Fare zones to match; a route matches when it serves any of them. Empty matches every route. */
  zones: FareZoneKey[];
  /** Operator slug to match, or null for every operator. */
  op: string | null;
  /** Which school services count. */
  school: SchoolFilter;
  /** Only routes running late, or early, on average; null for both. */
  direction: DelayDirection;
  /** Only routes with enough arrivals to rank on the boards. */
  enoughData: boolean;
  /** Only routes with at least one cancellation. */
  cancelledOnly: boolean;
  /** Only routes with a vehicle on a run now, from AT's live feed. */
  runningNow: boolean;
  sort: ExplorerSort;
  dir: SortDir;
}

/** The filters a fresh visit starts with. */
export const DEFAULT_FILTERS: ExplorerFilters = {
  q: "",
  mode: null,
  areas: [],
  zones: [],
  op: null,
  school: "exclude",
  direction: null,
  enoughData: false,
  cancelledOnly: false,
  runningNow: false,
  sort: "route",
  dir: "asc",
};

/**
 * The direction a sort opens in.
 * @param sort - The sort.
 * @returns Its default direction.
 */
export function defaultDir(sort: ExplorerSort): SortDir {
  return EXPLORER_SORTS.find((s) => s.key === sort)?.dir ?? "desc";
}

/**
 * Fold text for search: lower case, macrons and other accents off, spaces and
 * hyphens gone, so "city link" finds "CityLink", "tamaki" finds "TāmakiLink" and
 * "sc" finds "S-C".
 * @param s - The text.
 * @returns The folded text.
 */
function searchFold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "");
}

/**
 * What the search box matches a route on: its code, AT's long name, its slug
 * and its published line or service name, folded by {@link searchFold}. The "|"
 * keeps a query from matching across two fields.
 * @param r - The route.
 * @returns The folded text.
 */
function searchText(r: ExplorerRoute): string {
  const name = lineName(r.mode, r.shortName) ?? "";
  return searchFold([r.shortName ?? "", r.longName, r.slug, name].join("|"));
}

/**
 * Read the filters from query params, falling back to the defaults for anything
 * missing or invalid.
 * @param sp - The raw query params.
 * @returns The filters.
 */
export function parseExplorerFilters(sp: Record<string, string | undefined>): ExplorerFilters {
  const sort = EXPLORER_SORTS.some((s) => s.key === sp.sort)
    ? (sp.sort as ExplorerSort)
    : DEFAULT_FILTERS.sort;
  const dir = sp.rev === "1" ? flipDir(defaultDir(sort)) : defaultDir(sort);
  return {
    q: sp.q?.slice(0, 100) ?? "",
    mode: parseMode(sp.mode),
    areas: [...new Set((sp.area ?? "").split(",").filter(isAreaKey))],
    zones: [...new Set((sp.zone ?? "").split(",").filter(isFareZoneKey))],
    // Checked only for shape: which operators exist is the rows' business, and
    // a slug no route carries simply matches nothing.
    op: /^[a-z0-9-]{1,60}$/.test(sp.op ?? "") ? sp.op! : null,
    school: parseSchoolFilter(sp.school),
    direction: parseDelayDirection(sp.dir),
    enoughData: sp.data === "1",
    cancelledOnly: sp.cancelled === "1",
    runningNow: sp.live === "1",
    sort,
    dir,
  };
}

/**
 * The query params for a filter state, leaving out everything at its default.
 * @param f - The filters.
 * @returns Param name to value.
 */
export function explorerQuery(f: ExplorerFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.q.trim()) out.q = f.q.trim();
  if (f.mode) out.mode = f.mode;
  if (f.areas.length > 0) out.area = f.areas.join(",");
  if (f.zones.length > 0) out.zone = f.zones.join(",");
  if (f.op) out.op = f.op;
  const school = schoolFilterParam(f.school);
  if (school) out.school = school;
  if (f.direction) out.dir = f.direction;
  if (f.enoughData) out.data = "1";
  if (f.cancelledOnly) out.cancelled = "1";
  if (f.runningNow) out.live = "1";
  if (f.sort !== DEFAULT_FILTERS.sort) out.sort = f.sort;
  if (f.dir !== defaultDir(f.sort)) out.rev = "1";
  return out;
}

/** The query param names {@link explorerQuery} can write. */
export const EXPLORER_PARAMS = [
  "q",
  "mode",
  "area",
  "zone",
  "op",
  "school",
  "data",
  "cancelled",
  "live",
  "sort",
  "rev",
  "dir",
];

/**
 * The arrivals a route needs before its figures rank: the boards' own bar,
 * lower for a single mode so ferries can pass it.
 * @param mode - The mode filter, or null for every mode.
 * @returns The minimum arrivals.
 */
export function minEventsFor(mode: Mode | null): number {
  return mode ? MIN_MODE_EVENTS : MIN_BOARD_EVENTS;
}

/**
 * Keep the routes that pass every active filter. The enough-data bar is
 * {@link minEventsFor}'s.
 * The running-now filter needs the live set, which streams in after the list:
 * until it arrives (null) that one filter is not applied, so the list is never
 * emptied by a feed that has not answered yet.
 * @param rows - Every route in the window.
 * @param f - The filters.
 * @param running - Slugs of the routes with a vehicle on a run now, or null
 *   while the live feed has not answered.
 * @returns The matching routes, in their original order.
 */
export function filterRoutes(
  rows: readonly ExplorerRoute[],
  f: ExplorerFilters,
  running: ReadonlySet<string> | null = null,
): ExplorerRoute[] {
  const q = searchFold(f.q);
  const minEvents = minEventsFor(f.mode);
  return rows.filter((r) => {
    if (q && !searchText(r).includes(q)) return false;
    if (f.mode && r.mode !== f.mode) return false;
    if (f.areas.length > 0 && !r.areas.some((a) => f.areas.includes(a))) return false;
    if (f.zones.length > 0 && !r.zones.some((z) => f.zones.includes(z))) return false;
    if (f.op && r.operator !== f.op) return false;
    if (!schoolAllows(f.school, r.school)) return false;
    if (f.direction === "late" && !((r.avg_delay_sec ?? 0) > 0)) return false;
    if (f.direction === "early" && !((r.avg_delay_sec ?? 0) < 0)) return false;
    if (f.enoughData && r.events < minEvents) return false;
    if (f.cancelledOnly && r.cancelled === 0) return false;
    if (f.runningNow && running && !running.has(r.slug)) return false;
    return true;
  });
}

/**
 * A route's value for a sort, or null when it has none.
 * @param r - The route.
 * @param sort - The sort.
 * @returns The value.
 */
function sortValue(r: ExplorerRoute, sort: Exclude<ExplorerSort, "route">): number | null {
  switch (sort) {
    case "ontime":
      return r.on_time_pct;
    case "off":
      // As the Most off-schedule board: the signed average stands in when a row has no absolute one.
      return r.avg_abs_delay_sec ?? (r.avg_delay_sec === null ? null : Math.abs(r.avg_delay_sec));
    case "delay":
      return r.avg_delay_sec;
    case "late":
      return r.late_pct ?? null;
    case "early":
      return r.early_pct ?? null;
    case "arrivals":
      return r.events;
    case "cancelled":
      return r.cancelled;
  }
}

/** The sorts by a rate or an average, which a handful of arrivals cannot be trusted on. */
const FIGURE_SORTS: ReadonlySet<ExplorerSort> = new Set([
  "ontime",
  "off",
  "delay",
  "late",
  "early",
]);

/**
 * Whether a route sits out a sort's ranking: no value for it, or, on a rate or
 * an average, too few arrivals for the figure to mean much. Counts (arrivals,
 * cancellations) rank every route that has one.
 * @param r - The route.
 * @param sort - The sort.
 * @param minEvents - The arrivals a route needs to rank, from {@link minEventsFor}.
 * @returns True when the route is listed after the ranked ones.
 */
export function unranked(r: ExplorerRoute, sort: ExplorerSort, minEvents: number): boolean {
  if (sort === "route") return false;
  return sortValue(r, sort) === null || (FIGURE_SORTS.has(sort) && r.events < minEvents);
}

/**
 * Compare route names with numeric awareness, so 9 sorts before 100.
 * @param a - First route.
 * @param b - Second route.
 * @returns The standard sort contract.
 */
function byName(a: ExplorerRoute, b: ExplorerRoute): number {
  return compareRouteNumbers(routeDisplayName(a), routeDisplayName(b));
}

/**
 * Sort routes by a measure, in three tiers whichever way the sort runs: the
 * ranked routes, then those with too few arrivals to rank (sorted the same way
 * among themselves), then those with no value at all (by route number). So a
 * 3-arrival route at 100% on time never heads the list. Ties on on-time % go to
 * the route less off schedule, as on the Most reliable board; every other tie
 * falls back to route number.
 * @param rows - The routes.
 * @param sort - The measure.
 * @param dir - The direction.
 * @param minEvents - The arrivals a route needs to rank, from {@link minEventsFor}.
 * @returns A sorted copy.
 */
export function sortRoutes(
  rows: readonly ExplorerRoute[],
  sort: ExplorerSort,
  dir: SortDir,
  minEvents: number = MIN_BOARD_EVENTS,
): ExplorerRoute[] {
  const sign = dir === "asc" ? 1 : -1;
  if (sort === "route") return [...rows].sort((a, b) => sign * byName(a, b));
  /**
   * A route's tier: 0 ranked, 1 too few arrivals, 2 no value.
   * @param r - The route.
   * @param v - Its value for the sort.
   * @returns The tier.
   */
  const tier = (r: ExplorerRoute, v: number | null): number =>
    v === null ? 2 : unranked(r, sort, minEvents) ? 1 : 0;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort);
    const vb = sortValue(b, sort);
    const byTier = tier(a, va) - tier(b, vb);
    if (byTier !== 0) return byTier;
    if (va === null || vb === null) return byName(a, b);
    const tie =
      sort === "ontime" ? -sign * ((a.avg_abs_delay_sec ?? 0) - (b.avg_abs_delay_sec ?? 0)) : 0;
    return sign * (va - vb) || tie || byName(a, b);
  });
}

/** A preset of the Routes page: the whole list, or one of the home page's boards in full. */
export type ExplorerView = "all" | "off" | "reliable";

/**
 * The sort each preset opens on. The boards' enough-data bar needs no filter
 * here: {@link sortRoutes} lists the routes under it after the ranked ones.
 */
const VIEW_SORTS: Record<ExplorerView, Pick<ExplorerFilters, "sort" | "dir">> = {
  all: { sort: "route", dir: "asc" },
  off: { sort: "off", dir: "desc" },
  reliable: { sort: "ontime", dir: "desc" },
};

/**
 * The Routes page query for a preset, keeping the given filters.
 * @param view - The preset.
 * @param keep - Filters to carry (mode, school services, late or early, areas).
 * @returns Param name to value.
 */
export function viewQuery(
  view: ExplorerView,
  keep: Partial<Pick<ExplorerFilters, "mode" | "school" | "direction" | "areas">> = {},
): Record<string, string> {
  return explorerQuery({ ...DEFAULT_FILTERS, ...keep, ...VIEW_SORTS[view] });
}
