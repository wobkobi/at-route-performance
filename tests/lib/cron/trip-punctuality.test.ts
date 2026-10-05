// tests/lib/cron/trip-punctuality.test.ts
// Tests the nightly trip-measure tally: cancellations, the read's bounds, the live-day clip and
// the stored rows.
import {
  flagsDueBefore,
  judgingCutoff,
  routePunctuality,
  staleTallyDelete,
  TRIP_TALLY_INDEXES,
  tripEndsPipeline,
  tripTallyUpsertOps,
  type TripEndsRow,
} from "@/lib/cron/trip-punctuality";
import {
  nzServiceDayRange,
  serviceDayClockInstant,
  serviceDayScanRange,
} from "@/lib/time/service-day";
import { emptyCounts } from "@/lib/trip/punctuality";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

/**
 * A trip on route 70 read at its first and last stops.
 * @param id - Trip id.
 * @param depSec - Departure deviation.
 * @param arrSec - Arrival deviation.
 * @returns The row.
 */
function trip(id: string, depSec: number, arrSec: number): TripEndsRow {
  return {
    _id: id,
    routeId: "70-203",
    starts: ["a", "b"],
    last: "z",
    r: [
      { s: "a", t: { $date: "2026-10-02T19:00:00.000Z" }, d: depSec },
      { s: "z", t: "2026-10-02T19:40:00.000Z", d: arrSec },
    ],
  };
}

/** The trip ids flagged in the tests below whose TripMeta carries stop ends. */
const JUDGEABLE = new Set(["cut", "gone", "back"]);

/** A live moment inside 2026-10-02's service day: 1pm on its GTFS clock. */
const LIVE_NOW = serviceDayClockInstant(nzServiceDayRange("2026-10-02").start, 13 * 3600);

/** A moment long after 2026-10-02's scan window has closed. */
const PAST_NOW = new Date("2026-10-05T00:00:00Z");

/**
 * The first `$match` of the day's pipeline.
 * @param now - The present the pipeline is built at.
 * @returns The match stage's body.
 */
function firstMatch(now: Date): Record<string, unknown> {
  return (tripEndsPipeline("2026-10-02", now)[0] as { $match: Record<string, unknown> }).$match;
}

describe("routePunctuality", () => {
  it("judges each trip and files it under its route", () => {
    const counts = routePunctuality([trip("t1", 0, 0), trip("t2", 400, 0)], [], JUDGEABLE);
    expect(counts.get("70-203")).toEqual({
      departed: 2,
      reliable: 2,
      timed: 2,
      punctual: 1,
      cancelled: 0,
    });
  });

  it("counts a never-ran or cut-short trip once, as a cancellation, and judges a reinstated one", () => {
    const counts = routePunctuality(
      [trip("cut", 0, 0), trip("back", 0, 0)],
      [
        { tripId: "cut", routeId: "70-203", stage: "mid-trip" },
        { tripId: "gone", routeId: "NX1-203", stage: "before" },
        { tripId: "back", routeId: "70-203", stage: "ran" },
      ],
      JUDGEABLE,
    );
    expect(counts.get("70-203")).toEqual({
      departed: 1,
      reliable: 1,
      timed: 1,
      punctual: 1,
      cancelled: 1,
    });
    expect(counts.get("NX1-203")).toEqual({ ...emptyCounts(), cancelled: 1 });
  });

  it("counts no cancellation for a trip without stop ends, but still never judges it as a run", () => {
    const counts = routePunctuality(
      [trip("no-ends", 0, 0), trip("t1", 0, 0)],
      [
        { tripId: "no-ends", routeId: "70-203", stage: "mid-trip" },
        { tripId: "school", routeId: "S-203", stage: "before" },
      ],
      JUDGEABLE,
    );
    expect(counts.get("70-203")).toEqual({
      departed: 1,
      reliable: 1,
      timed: 1,
      punctual: 1,
      cancelled: 0,
    });
    expect(counts.has("S-203")).toBe(false);
  });
});

describe("judgingCutoff", () => {
  it("stops at the scan window's end once the window has passed", () => {
    expect(judgingCutoff("2026-10-02", PAST_NOW)).toEqual(serviceDayScanRange("2026-10-02").end);
  });

  it("stops at now while the window is open", () => {
    expect(judgingCutoff("2026-10-02", LIVE_NOW)).toEqual(LIVE_NOW);
  });
});

describe("tripEndsPipeline", () => {
  it("reads a past day's whole scan window, matched on its stamped service date", () => {
    const scan = serviceDayScanRange("2026-10-02");
    const match = firstMatch(PAST_NOW);
    expect(match.serviceDate).toBe("2026-10-02");
    expect(match.scheduledAt).toEqual({
      $gte: { $date: scan.start.toISOString() },
      $lt: { $date: scan.end.toISOString() },
    });
    expect(match.actualAt).toEqual({ $lt: { $date: PAST_NOW.toISOString() } });
    expect(match.ghost).toEqual({ $ne: true });
  });

  it("clips the live day's window and its readings at now, so no prediction is judged", () => {
    const match = firstMatch(LIVE_NOW);
    expect(match.scheduledAt).toEqual({
      $gte: { $date: serviceDayScanRange("2026-10-02").start.toISOString() },
      $lt: { $date: LIVE_NOW.toISOString() },
    });
    expect(match.actualAt).toEqual({ $lt: { $date: LIVE_NOW.toISOString() } });
  });
});

describe("flagsDueBefore", () => {
  /**
   * A flag, as far as the clip reads it.
   * @param tripId - Trip id; an AT-shaped id encodes its start seconds.
   * @param startTime - GTFS start time, or null when stored without one.
   * @returns The flag.
   */
  const flag = (
    tripId: string,
    startTime: string | null,
  ): { tripId: string; startTime: string | null } => ({ tripId, startTime });

  it("keeps on the live day only the flags due before now, and those with no start", () => {
    const due = flagsDueBefore(
      [
        flag("a", "12:30:00"),
        flag("b", "13:00:00"),
        flag("c", "18:00:00"),
        flag("1060-14804-43200-2-efb6f52a", null),
        flag("1060-14804-82800-2-efb6f52a", null),
        flag("odd-id", null),
      ],
      "2026-10-02",
      LIVE_NOW,
    );
    expect(due.map((f) => f.tripId)).toEqual(["a", "1060-14804-43200-2-efb6f52a", "odd-id"]);
  });

  it("keeps every flag of a past day, post-midnight runs included", () => {
    const flags = [flag("a", "05:00:00"), flag("b", "23:30:00"), flag("c", "25:30:00")];
    const cutoff = judgingCutoff("2026-10-02", PAST_NOW);
    expect(flagsDueBefore(flags, "2026-10-02", cutoff)).toEqual(flags);
  });
});

describe("tripTallyUpsertOps", () => {
  it("upserts each route's row on the exact day start, cancellation-only routes included", () => {
    const day = { $date: nzServiceDayRange("2026-10-02").start.toISOString() };
    const ops = tripTallyUpsertOps(
      new Map([
        ["70-203", { departed: 9, reliable: 8, timed: 7, punctual: 6, cancelled: 1 }],
        ["999-1", { departed: 0, reliable: 0, timed: 0, punctual: 0, cancelled: 2 }],
      ]),
      "2026-10-02",
    );
    expect(ops).toEqual([
      {
        q: { routeId: "70-203", date: day },
        u: {
          $set: {
            routeId: "70-203",
            date: day,
            departed: 9,
            reliable: 8,
            timed: 7,
            punctual: 6,
            cancelled: 1,
          },
        },
        upsert: true,
      },
      {
        q: { routeId: "999-1", date: day },
        u: {
          $set: {
            routeId: "999-1",
            date: day,
            departed: 0,
            reliable: 0,
            timed: 0,
            punctual: 0,
            cancelled: 2,
          },
        },
        upsert: true,
      },
    ]);
  });
});

describe("staleTallyDelete", () => {
  it("clears the day's rows for every route the run did not tally", () => {
    const { start, end } = nzServiceDayRange("2026-10-02");
    expect(staleTallyDelete(["70-203"], "2026-10-02")).toEqual({
      q: {
        date: { $gte: { $date: start.toISOString() }, $lt: { $date: end.toISOString() } },
        routeId: { $nin: ["70-203"] },
      },
      limit: 0,
    });
  });

  it("clears the whole day when nothing was tallied", () => {
    expect(staleTallyDelete([], "2026-10-02").q).toMatchObject({ routeId: { $nin: [] } });
  });
});

describe("TRIP_TALLY_INDEXES", () => {
  it("names its indexes the way Prisma names the model's", () => {
    const names = (TRIP_TALLY_INDEXES.indexes as { name: string }[]).map((i) => i.name);
    expect(names).toEqual(["DailyTripTally_routeId_date_key", "DailyTripTally_date_idx"]);
  });
});
