// tests/lib/aggregate.test.ts
// Unit tests for the pure parts of the nightly rollup: the pipeline shape, the
// upsert entries (daily and hourly) and the catch-up rule.
import {
  CATCH_UP_EXTRA_DAYS,
  catchUpDates,
  dailySummaryPipeline,
  daySummarised,
  HOURLY_SUMMARY_INDEXES,
  hourlySummaryPipeline,
  hourlyUpsertOps,
  summaryUpsertOps,
  type DailyStats,
} from "@/lib/aggregate";
import { NO_DELAY_SOURCE, realDeviationExprFor, UNCLASSIFIED_LIMIT_SEC } from "@/lib/deviation";
import { NZ_TZ, nzServiceDayRange } from "@/lib/time/service-day";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));

// The module imports the Prisma client and the ghost pass; the pure parts never
// touch them, and daySummarised needs only this one point read.
vi.mock("@/lib/db", () => ({ prisma: { dailyRouteSummary: { findFirst } } }));

const range = nzServiceDayRange("2026-09-11");

describe("dailySummaryPipeline", () => {
  it("matches the day half-open, drops no-delay rows and counts every other event", () => {
    const [match, group] = dailySummaryPipeline(range, true);
    expect(match).toEqual({
      $match: {
        scheduledAt: {
          $gte: { $date: "2026-09-10T16:00:00.000Z" },
          $lt: { $date: "2026-09-11T16:00:00.000Z" },
        },
        source: { $ne: NO_DELAY_SOURCE },
      },
    });
    expect((group as { $group: { events: unknown } }).$group.events).toEqual({ $sum: 1 });
  });

  it("guards every divisor and carries no percentile stage", () => {
    const text = JSON.stringify(dailySummaryPipeline(range, true));
    expect(text).toContain('"$max":[1,"$_plausible"]');
    expect(text).not.toContain("$percentile");
    expect(text).not.toContain("_delays");
  });

  it("drops the magnitude guard once the day is classified", () => {
    const classified = JSON.stringify(dailySummaryPipeline(range, true));
    const unclassified = JSON.stringify(dailySummaryPipeline(range, false));
    expect(classified).not.toContain(String(UNCLASSIFIED_LIMIT_SEC));
    expect(unclassified).toContain(String(UNCLASSIFIED_LIMIT_SEC));
  });

  it("counts every event but rates only the real readings", () => {
    const group = (dailySummaryPipeline(range, true)[1] as { $group: Record<string, unknown> })
      .$group;
    // The total stays every row, so a route with ghost readings is not pushed
    // below the rankings threshold.
    expect(group.events).toEqual({ $sum: 1 });
    // Each counter carries the same guard the delay averages already use.
    const plausible = JSON.stringify(realDeviationExprFor(true));
    expect(JSON.stringify(group.on_time_strict)).toContain(plausible);
    expect(JSON.stringify(group.on_time_ferry)).toContain(plausible);
    expect(JSON.stringify(group.early_strict)).toContain(plausible);
    expect(JSON.stringify(group.early_ferry)).toContain(plausible);
    expect(JSON.stringify(group.late_count)).toContain(plausible);
  });

  it("divides every rate by the real-reading count, not by the total", () => {
    const rates = (dailySummaryPipeline(range, true)[5] as { $addFields: Record<string, unknown> })
      .$addFields;
    for (const key of ["on_time_pct", "early_pct", "late_pct"]) {
      const text = JSON.stringify(rates[key]);
      expect(text).toContain('"$max":[1,"$_plausible"]');
      expect(text).not.toContain('"$events"');
    }
  });
});

describe("summaryUpsertOps", () => {
  it("keys each entry on (routeId, date) and upserts the day's stats", () => {
    const stats: DailyStats[] = [
      {
        _id: "NX1-201",
        events: 120,
        avg_delay_sec: 42.5,
        avg_abs_delay_sec: 60.1,
        on_time_pct: 81.2,
        early_pct: 3.1,
        late_pct: 15.7,
      },
    ];
    expect(summaryUpsertOps(stats, range.start, 300)).toEqual([
      {
        q: { routeId: "NX1-201", date: { $date: "2026-09-10T16:00:00.000Z" } },
        u: {
          $set: {
            routeId: "NX1-201",
            date: { $date: "2026-09-10T16:00:00.000Z" },
            events: 120,
            avgDelaySec: 42.5,
            avgAbsDelaySec: 60.1,
            onTimePct: 81.2,
            earlyPct: 3.1,
            latePct: 15.7,
            thresholdSec: 300,
          },
        },
        upsert: true,
      },
    ]);
  });
});

describe("hourlySummaryPipeline", () => {
  it("matches the day as the daily pipeline does and groups by route and Auckland hour", () => {
    const [match, group] = hourlySummaryPipeline(range, true);
    expect(match).toEqual(dailySummaryPipeline(range, true)[0]);
    expect((group as { $group: { _id: unknown } }).$group._id).toEqual({
      routeId: "$routeId",
      hour: { $hour: { date: "$scheduledAt", timezone: NZ_TZ } },
    });
  });

  it("stores counts picked by mode, not rates", () => {
    const stages = hourlySummaryPipeline(range, true);
    const project = (stages.at(-1) as { $project: Record<string, unknown> }).$project;
    expect(Object.keys(project).sort()).toEqual(
      ["_id", "early", "events", "late", "on_time", "plausible", "sum_abs", "sum_delay"].sort(),
    );
    expect(JSON.stringify(stages)).not.toContain("$divide");
  });
});

describe("hourlyUpsertOps", () => {
  it("keys each entry on (routeId, date, hour)", () => {
    const [op] = hourlyUpsertOps(
      [
        {
          _id: { routeId: "NX1-201", hour: 7 },
          events: 50,
          plausible: 48,
          sum_delay: 960,
          sum_abs: 1200,
          on_time: 40,
          early: 2,
          late: 6,
        },
      ],
      range.start,
      300,
    );
    expect(op).toEqual({
      q: { routeId: "NX1-201", date: { $date: "2026-09-10T16:00:00.000Z" }, hour: 7 },
      u: {
        $set: {
          routeId: "NX1-201",
          date: { $date: "2026-09-10T16:00:00.000Z" },
          hour: 7,
          events: 50,
          plausible: 48,
          sumDelaySec: 960,
          sumAbsDelaySec: 1200,
          onTime: 40,
          early: 2,
          late: 6,
          thresholdSec: 300,
        },
      },
      upsert: true,
    });
  });

  it("names its indexes the way Prisma names the model's", () => {
    const names = (HOURLY_SUMMARY_INDEXES.indexes as { name: string }[]).map((i) => i.name);
    expect(names).toEqual([
      "HourlyRouteSummary_routeId_date_hour_key",
      "HourlyRouteSummary_date_idx",
    ]);
  });
});

describe("catchUpDates", () => {
  it("always covers yesterday and nothing else when the earlier days are summarised", () => {
    expect(
      catchUpDates(
        "2026-09-12",
        () => true,
        () => true,
      ),
    ).toEqual(["2026-09-12"]);
  });

  it("adds an earlier day that has events but no summary, oldest first", () => {
    const missing = new Set(["2026-09-10", "2026-09-11"]);
    expect(
      catchUpDates(
        "2026-09-12",
        (d) => !missing.has(d),
        () => true,
      ),
    ).toEqual(["2026-09-10", "2026-09-11", "2026-09-12"]);
  });

  it("skips an unsummarised day with no events, such as one the purge emptied", () => {
    expect(
      catchUpDates(
        "2026-09-12",
        () => false,
        (d) => d !== "2026-09-10",
      ),
    ).toEqual(["2026-09-11", "2026-09-12"]);
  });

  it("looks back exactly the configured number of days", () => {
    const seen: string[] = [];
    catchUpDates(
      "2026-09-12",
      (d) => {
        seen.push(d);
        return true;
      },
      () => true,
    );
    expect(seen).toHaveLength(CATCH_UP_EXTRA_DAYS);
    expect(seen).toEqual(["2026-09-10", "2026-09-11"]);
  });

  it("steps by service date across a DST switch", () => {
    // 28 Sep 2026 is the day after NZDT starts; the two earlier dates are still
    // one calendar day apart each.
    expect(
      catchUpDates(
        "2026-09-28",
        () => false,
        () => true,
      ),
    ).toEqual(["2026-09-26", "2026-09-27", "2026-09-28"]);
  });
});

describe("daySummarised", () => {
  beforeEach(() => {
    findFirst.mockReset();
  });

  it("matches the stored stamp by service-day range, not by equality", async () => {
    findFirst.mockResolvedValue({ id: "sum1" });
    const day = nzServiceDayRange("2026-09-11");
    await expect(daySummarised("2026-09-11")).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { date: { gte: day.start, lt: day.end } },
      select: { id: true },
    });
  });

  it("finds a summary stamped at the old boundary hour from the new window", () => {
    // Arithmetic in both directions, so this case holds before and after the
    // flip. Under 5am, 2026-09-11's window is [10 Sep 17:00Z, 11 Sep 17:00Z) and
    // holds that day's 17:00Z stamp; under 4am it is [10 Sep 16:00Z, 11 Sep
    // 16:00Z) and still holds the same stamp, and no neighbouring day's.
    const { start, end } = nzServiceDayRange("2026-09-11");
    const stamped = new Date("2026-09-10T17:00:00Z");
    expect(stamped >= start).toBe(true);
    expect(stamped < end).toBe(true);
    expect(new Date("2026-09-11T17:00:00Z") < end).toBe(false);
  });

  it("reports a day with no summary row as false", async () => {
    findFirst.mockResolvedValue(null);
    await expect(daySummarised("2026-09-11")).resolves.toBe(false);
  });
});
