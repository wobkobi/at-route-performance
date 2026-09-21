// tests/lib/route-explorer.test.ts
// Unit tests for the Routes page filters and sorts.
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import {
  activeView,
  DEFAULT_FILTERS,
  explorerQuery,
  filterRoutes,
  PAGE_SIZE,
  parseExplorerFilters,
  parseShown,
  sortRoutes,
  viewQuery,
  type ExplorerFilters,
  type ExplorerRoute,
} from "@/lib/route-explorer";
import { describe, expect, it } from "vitest";

/**
 * A route row with sensible defaults.
 * @param slug - Route slug (also its short name).
 * @param extra - Fields to override.
 * @returns The row.
 */
function route(slug: string, extra: Partial<ExplorerRoute> = {}): ExplorerRoute {
  return {
    route_id: `${slug}-203`,
    slug,
    short_name: slug,
    long_name: `${slug} long name`,
    mode: "BUS",
    events: 500,
    avg_delay_sec: 60,
    avg_abs_delay_sec: 90,
    on_time_pct: 80,
    early_pct: 5,
    late_pct: 15,
    areas: ["central"],
    cancelled: 0,
    school: false,
    ...extra,
  };
}

/**
 * Filters from the defaults with some fields set.
 * @param extra - Fields to set.
 * @returns The filters.
 */
function filters(extra: Partial<ExplorerFilters>): ExplorerFilters {
  return { ...DEFAULT_FILTERS, ...extra };
}

/**
 * The slugs of some routes, in order.
 * @param rows - The routes.
 * @returns Their slugs.
 */
function slugs(rows: ExplorerRoute[]): string[] {
  return rows.map((r) => r.slug);
}

describe("filterRoutes", () => {
  const rows = [
    route("NX1", { areas: ["central", "north"] }),
    route("70", { areas: ["central", "east"], avg_delay_sec: -30, cancelled: 3 }),
    route("S-C", { mode: "TRAIN", areas: ["central", "south"] }),
    route("046", { long_name: "S046", school: true, events: 40 }),
  ];

  it("hides school services unless asked", () => {
    expect(slugs(filterRoutes(rows, DEFAULT_FILTERS))).toEqual(["NX1", "70", "S-C"]);
    expect(slugs(filterRoutes(rows, filters({ school: true })))).toContain("046");
  });

  it("matches a route serving any chosen area", () => {
    expect(slugs(filterRoutes(rows, filters({ areas: ["north", "south"] })))).toEqual([
      "NX1",
      "S-C",
    ]);
  });

  it("filters by mode, lean, search and cancellations", () => {
    expect(slugs(filterRoutes(rows, filters({ mode: "TRAIN" })))).toEqual(["S-C"]);
    expect(slugs(filterRoutes(rows, filters({ lean: "early" })))).toEqual(["70"]);
    expect(slugs(filterRoutes(rows, filters({ q: "nx" })))).toEqual(["NX1"]);
    expect(slugs(filterRoutes(rows, filters({ cancelledOnly: true })))).toEqual(["70"]);
  });

  it("applies the boards' enough-data bar", () => {
    const thin = route("thin", { events: MIN_BOARD_EVENTS - 1 });
    expect(slugs(filterRoutes([thin], filters({ enoughData: true })))).toEqual([]);
  });
});

describe("sortRoutes", () => {
  const rows = [
    route("100", { on_time_pct: 70 }),
    route("9", { on_time_pct: null }),
    route("25", { on_time_pct: 90 }),
  ];

  it("sorts route numbers numerically", () => {
    expect(slugs(sortRoutes(rows, "route", "asc"))).toEqual(["9", "25", "100"]);
  });

  it("puts routes with no value last in either direction", () => {
    expect(slugs(sortRoutes(rows, "on_time", "desc"))).toEqual(["25", "100", "9"]);
    expect(slugs(sortRoutes(rows, "on_time", "asc"))).toEqual(["100", "25", "9"]);
  });
});

describe("query round trip", () => {
  it("writes only what differs from the defaults and reads it back", () => {
    const f = filters({ areas: ["west", "north"], mode: "BUS", sort: "off_by", dir: "desc" });
    const q = explorerQuery(f);
    expect(q).toEqual({ mode: "BUS", area: "west,north", sort: "off_by" });
    expect(parseExplorerFilters(q)).toEqual(f);
    expect(explorerQuery(DEFAULT_FILTERS)).toEqual({});
  });

  it("drops invalid values", () => {
    expect(parseExplorerFilters({ area: "mars,west", sort: "vibes", mode: "BOAT" })).toEqual(
      filters({ areas: ["west"] }),
    );
  });
});

describe("board presets", () => {
  it("recognise the Most off-schedule and Most reliable boards", () => {
    expect(activeView(DEFAULT_FILTERS)).toBe("all");
    expect(activeView(filters({ sort: "off_by", dir: "desc", enoughData: true }))).toBe("off");
    expect(activeView(filters({ sort: "on_time", dir: "desc", enoughData: true }))).toBe(
      "reliable",
    );
    expect(activeView(filters({ sort: "on_time", dir: "desc" }))).toBeNull();
  });

  it("link to a board with the filters carried", () => {
    expect(viewQuery("reliable", { mode: "BUS", lean: "late" })).toEqual({
      mode: "BUS",
      lean: "late",
      data: "1",
      sort: "on_time",
    });
    expect(viewQuery("all")).toEqual({});
  });

  it("break an on-time tie towards the route less off schedule, as the board does", () => {
    const rows = [
      route("wobbly", { on_time_pct: 90, avg_abs_delay_sec: 200 }),
      route("steady", { on_time_pct: 90, avg_abs_delay_sec: 50 }),
    ];
    expect(slugs(sortRoutes(rows, "on_time", "desc"))).toEqual(["steady", "wobbly"]);
  });

  it("read the row count back as a whole number of pages", () => {
    expect(parseShown(undefined)).toBe(PAGE_SIZE);
    expect(parseShown("")).toBe(PAGE_SIZE);
    expect(parseShown("nope")).toBe(PAGE_SIZE);
    expect(parseShown("-40")).toBe(PAGE_SIZE);
    expect(parseShown(String(PAGE_SIZE))).toBe(PAGE_SIZE);
    expect(parseShown(String(PAGE_SIZE * 3))).toBe(PAGE_SIZE * 3);
    // A hand-edited count lands on one the pager itself could have reached.
    expect(parseShown(String(PAGE_SIZE + 1))).toBe(PAGE_SIZE * 2);
  });

  it("rank a route with no absolute average by its signed one on off-by", () => {
    const rows = [
      route("abs", { avg_abs_delay_sec: 100 }),
      route("signed", { avg_abs_delay_sec: null, avg_delay_sec: -300 }),
    ];
    expect(slugs(sortRoutes(rows, "off_by", "desc"))).toEqual(["signed", "abs"]);
  });
});
