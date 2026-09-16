// src/lib/run-day.test.ts
// The service date one run belongs to: AT's own start_date when it sends one,
// else the service day of the run's earliest scheduled stop. Every instant here
// is clear of both the 4am and the 5am boundary, so the cases hold on either
// side of the move; the boundary cases themselves live with the flip.
import type { Trip } from "@/lib/at";
import {
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
