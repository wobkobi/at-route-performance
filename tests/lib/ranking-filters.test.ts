import {
  cancellationMatches,
  hasRankingFilters,
  NO_RANKING_FILTERS,
  parseRankingFilters,
  rankingFilterParams,
  rankingFiltersPhrase,
  rankingFiltersReach,
  routeQueryWithHours,
  rowsInAreas,
  type FilterableCancellation,
  type RankingFilters,
} from "@/lib/ranking-filters";
import { describe, expect, it } from "vitest";

const ROUTE_AREAS = { NX1: ["central", "north"], "70": ["central", "east"] } as const;

describe("parseRankingFilters", () => {
  it("reads all three and drops unreadable parts", () => {
    expect(
      parseRankingFilters({ hours: "7-9", days: "sat", area: "north,bogus,north" }, false),
    ).toEqual({ hours: { from: 7, to: 9 }, days: "sat", areas: ["north"] });
    expect(parseRankingFilters({ hours: "9-9", days: "x" }, false)).toEqual(NO_RANKING_FILTERS);
  });

  it("ignores the day type on a single day", () => {
    expect(parseRankingFilters({ days: "sun" }, true).days).toBeNull();
  });
});

describe("rankingFilterParams", () => {
  it("round-trips through the parser and leaves unset params off", () => {
    const f: RankingFilters = { hours: { from: 22, to: 2 }, days: "weekday", areas: ["west"] };
    const params = rankingFilterParams(f);
    expect(params).toEqual({ hours: "22-2", days: "weekday", area: "west" });
    expect(parseRankingFilters(params, false)).toEqual(f);
    expect(rankingFilterParams(NO_RANKING_FILTERS)).toEqual({
      hours: undefined,
      days: undefined,
      area: undefined,
    });
    expect(hasRankingFilters(NO_RANKING_FILTERS)).toBe(false);
    expect(hasRankingFilters(f)).toBe(true);
  });
});

describe("rowsInAreas", () => {
  const rows = [{ routeId: "NX1-203" }, { routeId: "70-201" }, { routeId: "S101-2" }];

  it("keeps routes serving any chosen area, matched by slug", () => {
    expect(rowsInAreas(rows, ["north"], ROUTE_AREAS)).toEqual([{ routeId: "NX1-203" }]);
    expect(rowsInAreas(rows, ["north", "east"], ROUTE_AREAS)).toHaveLength(2);
    expect(rowsInAreas(rows, [], ROUTE_AREAS)).toEqual(rows);
  });
});

describe("cancellationMatches", () => {
  // 7:30am in Auckland on Saturday 26 Sep (NZST, UTC+12).
  const trip: FilterableCancellation = {
    slug: "NX1",
    mode: "BUS",
    school: false,
    service_date: "2026-09-26",
    scheduled_start: "2026-09-25T19:30:00.000Z",
  };

  it("places a trip by its day type, its scheduled start and its route's areas", () => {
    const f: RankingFilters = { hours: { from: 7, to: 9 }, days: "sat", areas: ["north"] };
    expect(cancellationMatches(trip, f, ROUTE_AREAS)).toBe(true);
    expect(cancellationMatches(trip, { ...f, days: "sun" }, ROUTE_AREAS)).toBe(false);
    expect(cancellationMatches(trip, { ...f, hours: { from: 9, to: 15 } }, ROUTE_AREAS)).toBe(
      false,
    );
    expect(cancellationMatches(trip, { ...f, areas: ["east"] }, ROUTE_AREAS)).toBe(false);
  });

  it("drops a trip with no start from a time-of-day filter only", () => {
    const unknown = { ...trip, scheduled_start: null };
    expect(cancellationMatches(unknown, { ...NO_RANKING_FILTERS, days: "sat" }, {})).toBe(true);
    expect(
      cancellationMatches(unknown, { ...NO_RANKING_FILTERS, hours: { from: 7, to: 9 } }, {}),
    ).toBe(false);
  });
});

describe("routeQueryWithHours", () => {
  it("adds the hours to an empty or existing query", () => {
    expect(routeQueryWithHours("", { from: 7, to: 9 })).toBe("?hours=7-9");
    expect(routeQueryWithHours("?day=2026-09-27", { from: 7, to: 9 })).toBe(
      "?day=2026-09-27&hours=7-9",
    );
    expect(routeQueryWithHours("?day=2026-09-27", null)).toBe("?day=2026-09-27");
  });
});

describe("rankingFiltersPhrase", () => {
  it("names each set filter in order, or nothing", () => {
    expect(
      rankingFiltersPhrase(
        { hours: { from: 7, to: 9 }, days: "sat", areas: ["north"] },
        ["North Shore"],
        false,
      ),
    ).toBe("7am to 9am, Saturdays, North Shore");
    expect(rankingFiltersPhrase(NO_RANKING_FILTERS, [], false)).toBeNull();
  });

  it("reads a range to the day's end as now while the day runs", () => {
    const f = { ...NO_RANKING_FILTERS, hours: { from: 9, to: 4 } };
    expect(rankingFiltersPhrase(f, [], true)).toBe("9am to now");
    expect(rankingFiltersPhrase(f, [], false)).toBe("9am to end of day");
  });
});

describe("rankingFiltersReach", () => {
  const morning = { ...NO_RANKING_FILTERS, hours: { from: 7, to: 10 } };

  it("says the whole day view follows a time of day", () => {
    expect(rankingFiltersReach(morning, "day")).toBe("Everything on the page follows it.");
  });

  it("says the day's cards and vehicles keep every area", () => {
    const text = rankingFiltersReach({ ...morning, areas: ["north"] }, "day");
    expect(text).toContain("follow the time of day but cover every area");
    const areaOnly = rankingFiltersReach({ ...NO_RANKING_FILTERS, areas: ["north"] }, "day");
    expect(areaOnly).toContain("vehicle counts cover every area.");
  });

  it("says a week or month leaves the cards and vehicles whole", () => {
    expect(rankingFiltersReach(morning, "week")).toContain("cover the whole week.");
    expect(rankingFiltersReach(morning, "month")).toContain("cover the whole month.");
  });
});
