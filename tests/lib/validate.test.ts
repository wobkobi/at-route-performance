// tests/lib/validate.test.ts
// Unit tests for the API query schemas and the sanitised issue shape.
import {
  aggregateQuery,
  queryIssues,
  routeStatsQuery,
  stopsQuery,
  topRoutesQuery,
} from "@/lib/validate";
import { describe, expect, it } from "vitest";

describe("topRoutesQuery", () => {
  it("applies the defaults to an empty query", () => {
    expect(topRoutesQuery.parse({})).toEqual({ limit: 50, metric: "on_time_rate" });
  });

  it("reads an empty value as unset rather than failing", () => {
    expect(topRoutesQuery.parse({ limit: "", week: "", mode: "", metric: "" })).toEqual({
      limit: 50,
      metric: "on_time_rate",
    });
  });

  it("coerces and bounds the numbers", () => {
    expect(topRoutesQuery.parse({ limit: "25" })).toMatchObject({ limit: 25 });
    expect(topRoutesQuery.safeParse({ limit: "0" }).success).toBe(false);
    expect(topRoutesQuery.safeParse({ limit: "501" }).success).toBe(false);
    expect(topRoutesQuery.safeParse({ limit: "abc" }).success).toBe(false);
  });

  it("accepts only a real ISO week and a known mode", () => {
    expect(topRoutesQuery.parse({ week: "2026-W37", mode: "TRAIN" })).toMatchObject({
      week: "2026-W37",
      mode: "TRAIN",
    });
    expect(topRoutesQuery.safeParse({ week: "2026-W60" }).success).toBe(false);
    expect(topRoutesQuery.safeParse({ mode: "TRAM" }).success).toBe(false);
  });
});

describe("routeStatsQuery", () => {
  it("reads empty dates as the default window", () => {
    expect(routeStatsQuery.parse({ from: "", to: "" })).toEqual({ range: null, sort: "events" });
  });

  it("takes both dates as NZ service days, 4am to the 4am after the last", () => {
    // NZST is UTC+12 on 1 Sep, so 4am there is 16:00 UTC the day before.
    expect(routeStatsQuery.parse({ from: "2026-09-01", to: "2026-09-07" }).range).toEqual({
      start: new Date("2026-08-31T16:00:00Z"),
      end: new Date("2026-09-07T16:00:00Z"),
    });
  });

  it("refuses half a window, a backwards one and an overlong one", () => {
    expect(routeStatsQuery.safeParse({ from: "2026-09-01" }).success).toBe(false);
    expect(routeStatsQuery.safeParse({ to: "2026-09-01" }).success).toBe(false);
    expect(routeStatsQuery.safeParse({ from: "2026-09-07", to: "2026-09-01" }).success).toBe(false);
    expect(routeStatsQuery.safeParse({ from: "2026-01-01", to: "2026-09-01" }).success).toBe(false);
    expect(routeStatsQuery.safeParse({ from: "2026-02-30", to: "2026-03-02" }).success).toBe(false);
  });

  it("passes the stop order through", () => {
    expect(routeStatsQuery.parse({ sort: "avg_delay" }).sort).toBe("avg_delay");
  });
});

describe("stopsQuery", () => {
  it("defaults, bounds and refuses junk rather than guessing", () => {
    expect(stopsQuery.parse({})).toEqual({ limit: 200, offset: 0 });
    expect(stopsQuery.parse({ limit: "50", offset: "100" })).toEqual({ limit: 50, offset: 100 });
    expect(stopsQuery.safeParse({ limit: "5000" }).success).toBe(false);
    expect(stopsQuery.safeParse({ limit: "abc" }).success).toBe(false);
    expect(stopsQuery.safeParse({ offset: "-1" }).success).toBe(false);
  });
});

describe("aggregateQuery", () => {
  it("takes one real service date or none", () => {
    expect(aggregateQuery.parse({})).toEqual({});
    expect(aggregateQuery.parse({ date: "2026-09-20" })).toEqual({ date: "2026-09-20" });
    expect(aggregateQuery.safeParse({ date: "2026-02-31" }).success).toBe(false);
    expect(aggregateQuery.safeParse({ date: "yesterday" }).success).toBe(false);
  });
});

describe("queryIssues", () => {
  it("keeps each issue's field and message and nothing else", () => {
    const parsed = topRoutesQuery.safeParse({ limit: "abc", mode: "TRAM" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issues = queryIssues(parsed.error.issues);
    expect(issues.map((i) => i.path).sort()).toEqual(["limit", "mode"]);
    for (const issue of issues) {
      expect(Object.keys(issue).sort()).toEqual(["message", "path"]);
      expect(typeof issue.message).toBe("string");
    }
  });
});
