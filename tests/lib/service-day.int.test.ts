// tests/lib/service-day.int.test.ts
// Acceptance for the stored per-run service date: that a padded scan window
// plus a serviceDate equality returns exactly the rows the boundary rule would,
// that nothing is left unstamped, that no run outruns the pad, and that the
// straddler count stays where the measurement put it. Read-only, and every
// query bounded by scheduledAt. Needs DATABASE_URL: `npm run test:int`.
import { DATA_START_DAY } from "@/lib/data-start";
import { prisma } from "@/lib/db";
import {
  RUN_TAIL_HOURS,
  nzServiceDayRange,
  nzServiceDayString,
  serviceDayScanRange,
  shiftWeek,
} from "@/lib/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Completed service days to audit, newest last. Bounds the suite's runtime as the archive grows. */
const AUDIT_DAYS = 14;
/** More straddling runs than this on one day is a timetable change, not a rounding artefact. */
const STRADDLER_ALARM = 5;

/** One (tripId, serviceDate) group's extent, as the aggregation returns it. */
interface RunRow {
  tripId: string;
  serviceDate: string | null;
  first: string;
  last: string;
}

interface DayAudit {
  date: string;
  /** Rows stamped with this date, inside the padded window. */
  stored: number;
  /** Rows whose own scheduledAt falls in the unpadded day. */
  ruled: number;
  /** Rows stamped with this date that sit past the day's end. */
  pulledIn: number;
  /** Rows inside the unpadded day stamped with some other date. */
  pushedOut: number;
  unstamped: number;
  straddlerRuns: number;
  longest: { tripId: string; spanMin: number };
  /** Trip ids carrying more than one date inside this window, with their whole extent. */
  multiDate: { tripId: string; dates: string[]; spanMin: number }[];
}

const audits: DayAudit[] = [];

/**
 * Minutes between a group's first and last reading.
 * @param r - The group.
 * @returns Its span in minutes.
 */
function spanMin(r: RunRow): number {
  return (Date.parse(r.last) - Date.parse(r.first)) / 60_000;
}

beforeAll(async () => {
  const now = Date.now();
  // The newest service day whose pad has fully passed, so a partial day never
  // reads as a missing tail.
  let last = nzServiceDayString(new Date());
  while (serviceDayScanRange(last).end.getTime() > now) last = shiftWeek(last, -1);
  const dates: string[] = [];
  for (let d = last, i = 0; i < AUDIT_DAYS && d >= DATA_START_DAY; d = shiftWeek(d, -1), i++) {
    dates.unshift(d);
  }

  for (const date of dates) {
    const day = nzServiceDayRange(date);
    const pad = serviceDayScanRange(date);
    const [stored, ruled, pulledIn, pushedOut, unstamped] = await Promise.all([
      prisma.arrivalEvent.count({
        where: { serviceDate: date, scheduledAt: { gte: pad.start, lt: pad.end } },
      }),
      prisma.arrivalEvent.count({ where: { scheduledAt: { gte: day.start, lt: day.end } } }),
      prisma.arrivalEvent.count({
        where: { serviceDate: date, scheduledAt: { gte: day.end, lt: pad.end } },
      }),
      prisma.arrivalEvent.count({
        where: { scheduledAt: { gte: day.start, lt: day.end }, serviceDate: { not: date } },
      }),
      prisma.arrivalEvent.count({
        where: { serviceDate: null, scheduledAt: { gte: pad.start, lt: pad.end } },
      }),
    ]);

    // One group per (run, stamped date). A run that was folded correctly is one
    // group spanning the boundary; an unfolded one is two groups a few minutes
    // apart, which is what the multi-date check below is looking for.
    const res = (await prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: [
        {
          $match: {
            scheduledAt: {
              $gte: { $date: pad.start.toISOString() },
              $lt: { $date: pad.end.toISOString() },
            },
          },
        },
        {
          $group: {
            _id: { tripId: "$tripId", serviceDate: "$serviceDate" },
            first: { $min: "$scheduledAt" },
            last: { $max: "$scheduledAt" },
          },
        },
        {
          // ISO strings, not raw dates: extended JSON hands a date back as
          // { $date } and a long as { $numberLong }, and neither subtracts.
          $project: {
            _id: 0,
            tripId: "$_id.tripId",
            serviceDate: "$_id.serviceDate",
            first: { $dateToString: { date: "$first" } },
            last: { $dateToString: { date: "$last" } },
          },
        },
      ],
      cursor: { batchSize: 100_000 },
    })) as unknown as { cursor: { firstBatch: RunRow[] } };

    const runs = res.cursor.firstBatch;
    const ofDay = runs.filter((r) => r.serviceDate === date);
    const longest = ofDay.reduce(
      (w, r) => (spanMin(r) > w.spanMin ? { tripId: r.tripId, spanMin: spanMin(r) } : w),
      { tripId: "-", spanMin: 0 },
    );

    const byTrip = new Map<string, RunRow[]>();
    for (const r of runs) {
      const list = byTrip.get(r.tripId);
      if (list) list.push(r);
      else byTrip.set(r.tripId, [r]);
    }
    const multiDate: DayAudit["multiDate"] = [];
    for (const [tripId, list] of byTrip) {
      const dates = [...new Set(list.map((r) => r.serviceDate ?? "(unstamped)"))].sort();
      if (dates.length < 2) continue;
      const firstMs = Math.min(...list.map((r) => Date.parse(r.first)));
      const lastMs = Math.max(...list.map((r) => Date.parse(r.last)));
      multiDate.push({ tripId, dates, spanMin: (lastMs - firstMs) / 60_000 });
    }

    audits.push({
      date,
      stored,
      ruled,
      pulledIn,
      pushedOut,
      unstamped,
      straddlerRuns: ofDay.filter((r) => Date.parse(r.last) >= day.end.getTime()).length,
      longest,
      multiDate,
    });
  }
}, 120_000);

describe("stored service dates", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("agrees with the boundary rule on every completed day", () => {
    expect(audits.length).toBeGreaterThan(0);
    for (const a of audits) {
      expect(a.stored, `${a.date}: no rows at all`).toBeGreaterThan(0);
      // Every row the old derived rule gave this day, minus the ones that
      // belong to the previous day's runs, plus the tails this day's runs left
      // in the next one. Nothing else may differ.
      expect(a.stored, `${a.date}: stored vs ruled`).toBe(a.ruled - a.pushedOut + a.pulledIn);
    }
  });

  it("leaves no unstamped row in any completed day's scan window", () => {
    for (const a of audits) {
      // A Mongo null predicate matches a missing field as well as an explicit
      // null, which is what a backfilled-or-not check needs.
      expect(a.unstamped, `${a.date}: unstamped rows`).toBe(0);
    }
  });

  it("never lets one trip carry two dates unless it outran the padding", () => {
    for (const a of audits) {
      for (const m of a.multiDate) {
        // AT reuses a trip id every day its timetable runs, so a trip running
        // 04:00-07:00 daily meets tomorrow's run inside the pad; that pair spans
        // about a day, which is why the bar is the pad and not zero.
        expect(
          m.spanMin,
          `${a.date}: ${m.tripId} carries ${m.dates.join(" and ")} over ${m.spanMin} min`,
        ).toBeGreaterThan(RUN_TAIL_HOURS * 60);
      }
    }
  });

  it("holds every run inside RUN_TAIL_HOURS", () => {
    for (const a of audits) {
      // Beating the pad means either a reused trip id or a service pattern the
      // pad no longer covers; both change what a day board is allowed to claim.
      expect(
        a.longest.spanMin,
        `${a.date}: run ${a.longest.tripId} spans ${a.longest.spanMin} min`,
      ).toBeLessThanOrEqual(RUN_TAIL_HOURS * 60);
    }
  });

  it("keeps the straddler count to a handful per day", () => {
    for (const a of audits) {
      // A timetable change that puts real service across the boundary has to be
      // caught rather than silently padded around.
      expect(a.straddlerRuns, `${a.date}: straddling runs`).toBeLessThanOrEqual(STRADDLER_ALARM);
    }
  });

  it("starts the archive on the documented first day", async () => {
    const oldest = await prisma.arrivalEvent.findFirst({
      orderBy: { scheduledAt: "asc" },
      select: { scheduledAt: true, serviceDate: true },
    });
    expect(oldest).not.toBeNull();
    expect(nzServiceDayString(oldest?.scheduledAt ?? new Date())).toBe(DATA_START_DAY);
    expect(oldest?.serviceDate).not.toBeNull();
  });

  it("leaves no duplicate or pre-archive summary row", async () => {
    const floor = nzServiceDayRange(audits[0]?.date ?? DATA_START_DAY).start;
    const dup = (await prisma.$runCommandRaw({
      aggregate: "DailyRouteSummary",
      pipeline: [
        { $match: { date: { $gte: { $date: floor.toISOString() } } } },
        { $group: { _id: { routeId: "$routeId", date: "$date" }, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
        { $limit: 5 },
      ],
      cursor: {},
    })) as unknown as { cursor: { firstBatch: unknown[] } };
    expect(dup.cursor.firstBatch).toEqual([]);

    const early = await prisma.dailyRouteSummary.count({
      where: { date: { lt: nzServiceDayRange(DATA_START_DAY).start } },
    });
    expect(early).toBe(0);
  });
});
