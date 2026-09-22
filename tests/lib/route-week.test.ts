// tests/lib/route-week.test.ts
// Unit tests for the route week fold.
import { aggregateWeek } from "@/lib/route-week";
import type { RouteDay } from "@/types/api";
import { describe, expect, it } from "vitest";

/**
 * One day's figures.
 * @param events - Arrivals that day.
 * @param onTime - On-time share.
 * @returns The day.
 */
function day(events: number, onTime: number): RouteDay {
  return {
    date: "2026-09-20",
    events,
    avg_delay_sec: 60,
    avg_abs_delay_sec: 90,
    on_time_pct: onTime,
  };
}

describe("aggregateWeek", () => {
  it("weights each day by its arrivals", () => {
    // 900 arrivals at 60% and 100 at 100%: 64%, not the 80% a plain mean gives.
    expect(aggregateWeek([day(900, 60), day(100, 100)])?.on_time_pct).toBeCloseTo(64);
  });

  it("is null with nothing to weigh", () => {
    expect(aggregateWeek([])).toBeNull();
    expect(aggregateWeek([day(0, 50)])).toBeNull();
  });
});
