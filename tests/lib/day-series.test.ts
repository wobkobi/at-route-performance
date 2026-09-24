// tests/lib/day-series.test.ts
// Unit tests for the Day by day page's per-day slots.
import { daySlot } from "@/lib/day-series";
import type { TopRouteRow } from "@/types/api";
import { describe, expect, it } from "vitest";

/**
 * A route row with the fields the summary reads.
 * @param over - Fields to override.
 * @returns The row.
 */
function row(over: Partial<TopRouteRow>): TopRouteRow {
  return {
    route_id: "r",
    short_name: "1",
    long_name: "One",
    mode: "BUS",
    events: 100,
    avg_delay_sec: 60,
    avg_abs_delay_sec: 120,
    on_time_pct: 60,
    early_pct: 10,
    late_pct: 30,
    ...over,
  };
}

const ALL = { mode: null, includeSchool: false };

describe("daySlot", () => {
  it("leaves a day still to come blank", () => {
    expect(daySlot("2026-09-23", "2026-09-22", null, ALL)).toEqual({
      kind: "future",
      date: "2026-09-23",
    });
  });

  it("marks a past day with no arrivals as a gap, not a zero", () => {
    expect(daySlot("2026-09-20", "2026-09-22", null, ALL).kind).toBe("empty");
    expect(daySlot("2026-09-20", "2026-09-22", { rows: [], cancelled: 3 }, ALL).kind).toBe("empty");
  });

  it("keeps an empty day's cancellations, which are what explain it", () => {
    expect(daySlot("2026-09-20", "2026-09-22", { rows: [], cancelled: 3 }, ALL)).toEqual({
      kind: "empty",
      date: "2026-09-20",
      cancelled: 3,
    });
  });

  it("weights the day by arrivals and reads its verdict off the share", () => {
    const slot = daySlot(
      "2026-09-20",
      "2026-09-22",
      {
        rows: [row({ events: 300, on_time_pct: 60 }), row({ events: 100, on_time_pct: 80 })],
        cancelled: 4,
      },
      ALL,
    );
    expect(slot.kind).toBe("day");
    if (slot.kind !== "day") return;
    // (60*300 + 80*100) / 400 = 65: one route's share per arrival, not per route.
    expect(slot.summary.on_time_pct).toBe(65);
    expect(slot.summary.events).toBe(400);
    expect(slot.summary.cancelled).toBe(4);
    expect(slot.verdict?.label).toBe("Bit bad");
  });

  it("narrows by mode and drops school services, as the day view does", () => {
    const data = {
      rows: [
        row({ mode: "TRAIN", events: 100, on_time_pct: 90 }),
        row({ mode: "BUS", events: 100, on_time_pct: 50 }),
        row({ mode: "BUS", long_name: "S046", events: 100, on_time_pct: 10 }),
      ],
      cancelled: 0,
    };
    const train = daySlot("2026-09-20", "2026-09-22", data, {
      mode: "TRAIN",
      includeSchool: false,
    });
    expect(train.kind === "day" && train.verdict?.label).toBe("Great");
    const bus = daySlot("2026-09-20", "2026-09-22", data, { mode: "BUS", includeSchool: false });
    expect(bus.kind === "day" && bus.summary.events).toBe(100);
    const withSchool = daySlot("2026-09-20", "2026-09-22", data, {
      mode: "BUS",
      includeSchool: true,
    });
    expect(withSchool.kind === "day" && withSchool.summary.on_time_pct).toBe(30);
  });

  it("gives today a column", () => {
    expect(daySlot("2026-09-22", "2026-09-22", { rows: [row({})], cancelled: 0 }, ALL).kind).toBe(
      "day",
    );
  });
});
