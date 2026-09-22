// src/lib/route-explorer.ts
// Filters and sorts for the Routes page. Pure, so the page can run them on the
// client as the reader changes a control and the tests can pin them down. The
// filters round-trip through the query string, writing only what differs from
// the defaults, so a filtered view is a shareable link.
import { type AreaKey, isAreaKey } from "@/lib/areas";
import { MIN_BOARD_EVENTS, MIN_MODE_EVENTS } from "@/lib/rankings";
import type { TopRouteRow } from "@/types/api";

/** One route on the Routes page: its window stats plus what the filters need. */
export interface ExplorerRoute extends TopRouteRow {
  /** Version-stripped route slug, for links and joins. */
  slug: string;
  /** Areas the route served over the last week of completed days. */
  areas: AreaKey[];
  /** Trips cancelled in the window. */
  cancelled: number;
  /** Whether the route is a school service. */
  school: boolean;
}

/** A sortable measure. */
export type ExplorerSort =
  "route" | "on_time" | "off_by" | "delay" | "late" | "early" | "events" | "cancelled";

/** Sort direction. */
export type SortDir = "asc" | "desc";

/** Every sort with its label and the direction it opens in (the more telling end first). */
export const EXPLORER_SORTS: ReadonlyArray<{ key: ExplorerSort; label: string; dir: SortDir }> = [
  { key: "route", label: "Route number", dir: "asc" },
  { key: "on_time", label: "On-time %", dir: "desc" },
  { key: "off_by", label: "Average off by", dir: "desc" },
  { key: "delay", label: "Average delay", dir: "desc" },
  { key: "late", label: "Late %", dir: "desc" },
  { key: "early", label: "Early %", dir: "desc" },
  { key: "events", label: "Arrivals", dir: "desc" },
  { key: "cancelled", label: "Cancellations", dir: "desc" },
];

/** Transport mode filter, or null for every mode. */
export type ExplorerMode = "BUS" | "TRAIN" | "FERRY" | null;

/** Which way a route runs off schedule on average, or null for either. */
export type ExplorerLean = "late" | "early" | null;

/** The Routes page's filter and sort state. */
export interface ExplorerFilters {
  /** Free-text search over route number and name. */
  q: string;
  mode: ExplorerMode;
  /** Areas to match; a route matches when it serves any of them. Empty matches every route. */
  areas: AreaKey[];
  /** Include school services. */
  school: boolean;
  lean: ExplorerLean;
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
  school: false,
  lean: null,
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
 * Read the filters from query params, falling back to the defaults for anything
 * missing or invalid.
 * @param sp - The raw query params.
 * @returns The filters.
 */
export function parseExplorerFilters(sp: Record<string, string | undefined>): ExplorerFilters {
  const sort = EXPLORER_SORTS.some((s) => s.key === sp.sort)
    ? (sp.sort as ExplorerSort)
    : DEFAULT_FILTERS.sort;
  const dir: SortDir = sp.dir === "asc" || sp.dir === "desc" ? sp.dir : defaultDir(sort);
  return {
    q: sp.q?.slice(0, 100) ?? "",
    mode: sp.mode === "BUS" || sp.mode === "TRAIN" || sp.mode === "FERRY" ? sp.mode : null,
    areas: [...new Set((sp.area ?? "").split(",").filter(isAreaKey))],
    school: sp.school === "1",
    lean: sp.lean === "late" || sp.lean === "early" ? sp.lean : null,
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
  if (f.school) out.school = "1";
  if (f.lean) out.lean = f.lean;
  if (f.enoughData) out.data = "1";
  if (f.cancelledOnly) out.cancelled = "1";
  if (f.runningNow) out.live = "1";
  if (f.sort !== DEFAULT_FILTERS.sort) out.sort = f.sort;
  if (f.dir !== defaultDir(f.sort)) out.dir = f.dir;
  return out;
}

/** Routes the list opens with, and how many each "Show more" press adds. */
export const PAGE_SIZE = 40;

/** The query param holding how many rows the list is showing. */
export const SHOWN_PARAM = "show";

/**
 * Read how many rows the list was showing. Rounded up to a whole number of
 * pages so a hand-edited `show` still lands on a count the pager itself could
 * reach, and floored at one page. Nothing caps it: `shown` is only ever used to
 * slice, so a number past the end of the list simply shows all of it.
 * @param raw - The `show` param.
 * @returns The row count.
 */
export function parseShown(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= PAGE_SIZE) return PAGE_SIZE;
  return Math.ceil(n / PAGE_SIZE) * PAGE_SIZE;
}

/** The query param names {@link explorerQuery} can write. */
export const EXPLORER_PARAMS = [
  "q",
  "mode",
  "area",
  "school",
  "lean",
  "data",
  "cancelled",
  "live",
  "sort",
  "dir",
];

/**
 * Keep the routes that pass every active filter. The enough-data bar is the
 * boards' own: lower for a single mode, so ferries can pass it.
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
  const q = f.q.trim().toLowerCase();
  const minEvents = f.mode ? MIN_MODE_EVENTS : MIN_BOARD_EVENTS;
  return rows.filter((r) => {
    if (q && !`${r.short_name ?? ""} ${r.long_name} ${r.slug}`.toLowerCase().includes(q)) {
      return false;
    }
    if (f.mode && r.mode !== f.mode) return false;
    if (f.areas.length > 0 && !r.areas.some((a) => f.areas.includes(a))) return false;
    if (!f.school && r.school) return false;
    if (f.lean === "late" && !((r.avg_delay_sec ?? 0) > 0)) return false;
    if (f.lean === "early" && !((r.avg_delay_sec ?? 0) < 0)) return false;
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
    case "on_time":
      return r.on_time_pct;
    case "off_by":
      // As the Most off-schedule board: the signed average stands in when a row has no absolute one.
      return r.avg_abs_delay_sec ?? (r.avg_delay_sec === null ? null : Math.abs(r.avg_delay_sec));
    case "delay":
      return r.avg_delay_sec;
    case "late":
      return r.late_pct ?? null;
    case "early":
      return r.early_pct ?? null;
    case "events":
      return r.events;
    case "cancelled":
      return r.cancelled;
  }
}

/**
 * Compare route names with numeric awareness, so 9 sorts before 100.
 * @param a - First route.
 * @param b - Second route.
 * @returns The standard sort contract.
 */
function byName(a: ExplorerRoute, b: ExplorerRoute): number {
  return (a.short_name ?? a.slug).localeCompare(b.short_name ?? b.slug, undefined, {
    numeric: true,
  });
}

/**
 * Sort routes by a measure. Routes with no value for it go last whichever way
 * the sort runs. Ties on on-time % go to the route less off schedule, as on the
 * Most reliable board; every other tie falls back to route number.
 * @param rows - The routes.
 * @param sort - The measure.
 * @param dir - The direction.
 * @returns A sorted copy.
 */
export function sortRoutes(
  rows: readonly ExplorerRoute[],
  sort: ExplorerSort,
  dir: SortDir,
): ExplorerRoute[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort === "route") return sign * byName(a, b);
    const va = sortValue(a, sort);
    const vb = sortValue(b, sort);
    if (va === null || vb === null) return (va === null ? 1 : 0) - (vb === null ? 1 : 0);
    const tie =
      sort === "on_time" ? -sign * ((a.avg_abs_delay_sec ?? 0) - (b.avg_abs_delay_sec ?? 0)) : 0;
    return sign * (va - vb) || tie || byName(a, b);
  });
}

/** A preset of the Routes page: the whole list, or one of the home page's boards in full. */
export type ExplorerView = "all" | "off" | "reliable";

/**
 * The presets and the filters each sets. The two boards rank only routes with
 * enough data, as they do on the home page.
 */
export const EXPLORER_VIEWS: ReadonlyArray<{
  key: ExplorerView;
  label: string;
  filters: Pick<ExplorerFilters, "sort" | "dir" | "enoughData">;
}> = [
  { key: "all", label: "All routes", filters: { sort: "route", dir: "asc", enoughData: false } },
  {
    key: "off",
    label: "Most off-schedule",
    filters: { sort: "off_by", dir: "desc", enoughData: true },
  },
  {
    key: "reliable",
    label: "Most reliable",
    filters: { sort: "on_time", dir: "desc", enoughData: true },
  },
];

/**
 * The preset a filter state matches, if any.
 * @param f - The filters.
 * @returns The matching preset, or null for a custom sort.
 */
export function activeView(f: ExplorerFilters): ExplorerView | null {
  return (
    EXPLORER_VIEWS.find(
      (v) =>
        v.filters.sort === f.sort &&
        v.filters.dir === f.dir &&
        v.filters.enoughData === f.enoughData,
    )?.key ?? null
  );
}

/**
 * The Routes page query for a preset, keeping the given filters.
 * @param view - The preset.
 * @param keep - Filters to carry (mode, school services, lean).
 * @returns Param name to value.
 */
export function viewQuery(
  view: ExplorerView,
  keep: Partial<Pick<ExplorerFilters, "mode" | "school" | "lean">> = {},
): Record<string, string> {
  const preset = EXPLORER_VIEWS.find((v) => v.key === view)?.filters ?? {};
  return explorerQuery({ ...DEFAULT_FILTERS, ...keep, ...preset });
}
