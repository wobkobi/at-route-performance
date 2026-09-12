// src/lib/validate.test.ts
// Unit tests for the API query schemas and the sanitised issue shape.
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { queryIssues, routeStatsQuery, topRoutesQuery } from "@/lib/validate";
import { describe, expect, it } from "vitest";

describe("topRoutesQuery", () => {
  it("applies the defaults to an empty query", () => {
    expect(topRoutesQuery.parse({})).toEqual({
      limit: 50,
      metric: "on_time_rate",
      thresholdSec: ON_TIME_LATE_SEC,
    });
  });

  it("reads an empty value as unset rather than failing", () => {
    expect(
      topRoutesQuery.parse({ limit: "", week: "", mode: "", metric: "", thresholdSec: "" }),
    ).toEqual({
      limit: 50,
      metric: "on_time_rate",
      thresholdSec: ON_TIME_LATE_SEC,
    });
  });

  it("coerces and bounds the numbers", () => {
    expect(topRoutesQuery.parse({ limit: "25", thresholdSec: "120" })).toMatchObject({
      limit: 25,
      thresholdSec: 120,
    });
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
  it("reads empty dates as unset and coerces real ones", () => {
    expect(routeStatsQuery.parse({ from: "", to: "" })).toEqual({
      thresholdSec: ON_TIME_LATE_SEC,
      sort: "events",
    });
    expect(routeStatsQuery.parse({ from: "2026-09-01T00:00:00Z" }).from).toEqual(
      new Date("2026-09-01T00:00:00Z"),
    );
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
