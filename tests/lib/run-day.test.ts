// tests/lib/run-day.test.ts
// The service date one run belongs to: AT's own start_date when it sends one,
// else the service day of the run's earliest scheduled stop. Every instant here
// is clear of both the 4am and the 5am boundary, so the cases hold on either
// side of the move; the boundary cases themselves live with the flip.
import type { Trip } from "@/lib/at";
import {
  cancelledServiceDate,
  foldRunDates,
  parseStartDate,
  runServiceDate,
  tripIdServiceDate,
  type RunRowDate,
} from "@/lib/run-day";
import { describe, expect, it } from "vitest";

/**
 * A trip descriptor with the fields under test.
 * @param overrides - Fields to set.
 * @returns The descriptor.
 */
function trip(overrides: Partial<Trip> = {}): Trip {
  return { trip_id: "1108-15203-78300-2-58ac9d51", route_id: "152-203", ...overrides };
}

/**
 * One stored row of a run.
 * @param id - Row id.
 * @param iso - The row's `scheduledAt`.
 * @param serviceDate - The date the plain per-row rule gave it.
 * @param tripId - Trip id (defaults to one run).
 * @returns The row.
 */
function row(id: string, iso: string, serviceDate: string, tripId = "T"): RunRowDate {
  return { id, tripId, scheduledAt: new Date(iso), serviceDate };
}

describe("runServiceDate", () => {
  it("takes AT's own start_date over the schedule times", () => {
    // 08:00 on 15 Sep by the schedule, but AT dates the block itself to the 13th.
    expect(
      runServiceDate(
        trip({ start_date: "20260913", start_time: "24:00:00" }),
        new Date("2026-09-14T20:00:00Z"),
      ),
    ).toBe("2026-09-13");
  });

  it("falls back to the service day of the run's earliest stop", () => {
    // Midday on 14 Sep NZST.
    expect(runServiceDate(trip(), new Date("2026-09-14T00:00:00Z"))).toBe("2026-09-14");
    // 06:30 on 15 Sep: past both boundary hours.
    expect(runServiceDate(trip(), new Date("2026-09-14T18:30:00Z"))).toBe("2026-09-15");
    // 03:55 on 15 Sep: before both boundary hours, so still 14 September.
    expect(runServiceDate(trip(), new Date("2026-09-14T15:55:00Z"))).toBe("2026-09-14");
  });

  it("moves the 04:00-04:59 hour onto the day it now belongs to", () => {
    // 04:30 on 15 Sep: the first departure of the network's day. Under the old
    // 5am rule this filed under 14 September.
    expect(runServiceDate(trip(), new Date("2026-09-14T16:30:00Z"))).toBe("2026-09-15");
    // 03:59 on 15 Sep: still the 14 September service day.
    expect(runServiceDate(trip(), new Date("2026-09-14T15:59:00Z"))).toBe("2026-09-14");
  });

  it("falls through on every shape that is not eight real digits", () => {
    const runStart = new Date("2026-09-14T18:30:00Z");
    for (const start_date of ["2026-09-13", "20260931", "", "2026091", "abcdefgh"]) {
      expect(runServiceDate(trip({ start_date }), runStart)).toBe("2026-09-15");
    }
    expect(parseStartDate(undefined)).toBeNull();
  });
});

describe("tripIdServiceDate", () => {
  it("steps a post-midnight run back onto its own service date", () => {
    // Segment 86400 is midnight of the NEXT calendar day; min(scheduledAt)
    // 2026-09-13T12:00:00Z is 00:00 on 14 September Auckland.
    expect(tripIdServiceDate("1281-02504-86400-2-3df528a9", new Date("2026-09-13T12:00:00Z"))).toBe(
      "2026-09-13",
    );
  });

  it("leaves a same-day run on the calendar date it runs on", () => {
    // Segment 23400 is 06:30; the instant is 06:30 on 15 September Auckland.
    expect(
      tripIdServiceDate("122-91011-23400-2-512006552-42990445", new Date("2026-09-14T18:30:00Z")),
    ).toBe("2026-09-15");
  });

  it("gives up at or past 48 h, so the day offset is only ever 0 or 1", () => {
    expect(tripIdServiceDate("1-2-172800-2-abc", new Date("2026-09-14T18:30:00Z"))).toBeNull();
  });
});

describe("foldRunDates", () => {
  it("pulls a straddler's later rows onto the run's first date", () => {
    // The shape of 1185-07010-97500-2-9680d7a4: a genuine 03:05 departure still
    // reporting at 04:00, so its last rows label the next day on their own.
    const out = foldRunDates([
      row("a", "2026-09-11T15:05:00Z", "2026-09-11"),
      row("b", "2026-09-11T15:50:00Z", "2026-09-11"),
      row("c", "2026-09-11T16:00:00Z", "2026-09-12"),
    ]);
    expect([...out]).toEqual([["c", "2026-09-11"]]);
  });

  it("leaves a reused trip id's far rows alone", () => {
    // Rows more than RUN_TAIL_HOURS past the run's first reading keep their own
    // date, so a reused id cannot drag a whole day's readings onto one date.
    const out = foldRunDates([
      row("a", "2026-09-11T15:05:00Z", "2026-09-11"),
      row("far", "2026-09-11T20:00:00Z", "2026-09-12"),
    ]);
    expect(out.size).toBe(0);
  });

  it("takes the tail from the caller", () => {
    const rows = [
      row("a", "2026-09-11T15:05:00Z", "2026-09-11"),
      row("far", "2026-09-11T20:00:00Z", "2026-09-12"),
    ];
    expect([...foldRunDates(rows, 6)]).toEqual([["far", "2026-09-11"]]);
  });

  it("folds each trip against its own first reading and returns nothing for a clean run", () => {
    const out = foldRunDates([
      row("a1", "2026-09-11T16:00:00Z", "2026-09-12", "A"),
      row("a2", "2026-09-11T16:30:00Z", "2026-09-12", "A"),
      row("b1", "2026-09-11T15:10:00Z", "2026-09-11", "B"),
      row("b2", "2026-09-11T16:05:00Z", "2026-09-12", "B"),
    ]);
    expect([...out]).toEqual([["b2", "2026-09-11"]]);
  });
});

describe("cancelledServiceDate", () => {
  it("collapses one physical run's two stamps onto one date", () => {
    // 1061-04203-17100-2-8bc39bce, start 04:45, flagged twice ten minutes apart
    // either side of the old 05:00 rollover. One run, one day: the 04:45
    // departure on the morning of 16 September.
    expect(
      cancelledServiceDate(
        {
          tripId: "1061-04203-17100-2-8bc39bce",
          startTime: "04:45:00",
          detectedAt: new Date("2026-09-15T16:50:26.768Z"),
        },
        4,
      ),
    ).toBe("2026-09-16");
    expect(
      cancelledServiceDate(
        {
          tripId: "1061-04203-17100-2-8bc39bce",
          startTime: "04:45:00",
          detectedAt: new Date("2026-09-15T17:00:54.206Z"),
        },
        4,
      ),
    ).toBe("2026-09-16");
  });

  it("falls back to the trip id's start seconds when no start time was captured", () => {
    // Segment 82800 is 23:00; flagged at 23:10 on 14 September.
    expect(
      cancelledServiceDate(
        {
          tripId: "1060-14804-82800-2-efb6f52a",
          startTime: null,
          detectedAt: new Date("2026-09-14T11:10:00Z"),
        },
        4,
      ),
    ).toBe("2026-09-14");
  });

  it("takes AT's own start_date over everything else", () => {
    expect(
      cancelledServiceDate(
        {
          tripId: "1060-14804-82800-2-efb6f52a",
          startTime: "23:00:00",
          startDate: "20260912",
          detectedAt: new Date("2026-09-14T11:10:00Z"),
        },
        4,
      ),
    ).toBe("2026-09-12");
  });

  it("takes the detection day when nothing places the run", () => {
    expect(
      cancelledServiceDate(
        { tripId: "manual-flag", startTime: null, detectedAt: new Date("2026-09-15T16:50:26Z") },
        4,
      ),
    ).toBe("2026-09-16");
  });

  it("steps a flag raised on the far side of the boundary from its departure", () => {
    // Flagged 03:50 on 16 Sep, which is still service day 15 Sep. That day's
    // 06:00 departure was nearly 22 hours earlier, far past the lag allowance,
    // so the flag belongs to the run on the service day about to start.
    expect(
      cancelledServiceDate(
        {
          tripId: "1108-15203-21600-2-58ac9d51",
          startTime: "06:00:00",
          detectedAt: new Date("2026-09-15T15:50:00Z"),
        },
        4,
      ),
    ).toBe("2026-09-16");
  });

  it("keeps a run flagged at the early sweep on its own evening", () => {
    // 255-800006-63600, start 17:40 off the trip id, flagged 05:00 the same
    // morning. A lead of 12h39m is the longest AT gives, and it is still that
    // evening's run: the neighbouring day's 17:40 is eleven hours further off.
    expect(
      cancelledServiceDate(
        {
          tripId: "255-800006-63600-1-1099-3e24b49c",
          startTime: null,
          detectedAt: new Date("2026-09-11T17:00:53.753Z"),
        },
        4,
      ),
    ).toBe("2026-09-12");
  });

  it("keeps a run on its own day when the lead passes half a day", () => {
    // 258-880019-70080, start 19:28, flagged 07:12 that morning: 12h16m ahead.
    // Two rows exist for this trip, one per evening, so pulling this one back a
    // day would collide them and cost a real run.
    expect(
      cancelledServiceDate(
        {
          tripId: "258-880019-70080-2-W448681-b3ca574b",
          startTime: "19:28:00",
          detectedAt: new Date("2026-09-15T19:12:17.006Z"),
        },
        4,
      ),
    ).toBe("2026-09-16");
  });

  it("steps an evening flag onto the morning run it is warning about", () => {
    // 521-93021-23400, start 06:30, flagged 21:08 the night before. That day's
    // 06:30 left 14h38m earlier, so the flag is for the morning still to come.
    expect(
      cancelledServiceDate(
        {
          tripId: "521-93021-23400-1-9bc9d477",
          startTime: "06:30:00",
          detectedAt: new Date("2026-09-14T09:08:15.193Z"),
        },
        4,
      ),
    ).toBe("2026-09-15");
  });

  it("keeps a late-night run flagged after midnight on its own day", () => {
    // 1060-14804-82800, start 23:00, flagged 03:34 the next morning, which is
    // before the 4am boundary and so still service day 12 September.
    expect(
      cancelledServiceDate(
        {
          tripId: "1060-14804-82800-2-efb6f52a",
          startTime: "23:00:00",
          detectedAt: new Date("2026-09-12T15:34:13Z"),
        },
        4,
      ),
    ).toBe("2026-09-12");
  });
});
