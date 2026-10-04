// tests/lib/rankings.test.ts
// Unit tests for the ranking-board derivation and fleet-totals helpers in rankings.ts.

import { deriveBoards, summariseRows } from "@/lib/rankings";
import type { RouteRow } from "@/types/api";
import { describe, expect, it } from "vitest";

/**
 * Build a RouteRow for tests with sensible defaults.
 * @param p - Field overrides; `routeId` is required.
 * @returns A complete row.
 */
function row(p: Partial<RouteRow> & { routeId: string }): RouteRow {
  return {
    shortName: p.routeId,
    longName: `Route ${p.routeId}`,
    mode: "BUS",
    events: 100,
    avg_delay_sec: 0,
    avg_abs_delay_sec: 0,
    on_time_pct: 90,
    ...p,
  };
}

describe("deriveBoards", () => {
  const rows: RouteRow[] = [
    row({ routeId: "A", avg_delay_sec: 360, on_time_pct: 50, events: 100 }),
    row({ routeId: "B", avg_delay_sec: -240, on_time_pct: 70, events: 100 }),
    row({ routeId: "C", avg_delay_sec: 120, on_time_pct: 95, events: 100 }),
    row({ routeId: "D", avg_delay_sec: -600, on_time_pct: 99, events: 5 }), // below min
  ];

  it("latest is highest positive avg first, gated by minEvents", () => {
    const { latest } = deriveBoards(rows, { minEvents: 10 });
    expect(latest.map((r) => r.routeId)).toEqual(["A", "C", "B"]);
  });
  it("earliest is most-negative avg first, gated by minEvents", () => {
    const { earliest } = deriveBoards(rows, { minEvents: 10 });
    expect(earliest.map((r) => r.routeId)).toEqual(["B", "C", "A"]);
    expect(earliest.map((r) => r.routeId)).not.toContain("D"); // 5 events < 10
  });
  it("reliable is highest on_time_pct first, gated by minEvents", () => {
    const { reliable } = deriveBoards(rows, { minEvents: 10 });
    expect(reliable.map((r) => r.routeId)).toEqual(["C", "B", "A"]);
  });
  it("limits each board to size", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      row({ routeId: `R${i}`, avg_delay_sec: i * 10 }),
    );
    const { latest } = deriveBoards(many, { minEvents: 10, size: 10 });
    expect(latest).toHaveLength(10);
  });
});

describe("summariseRows", () => {
  it("weights each figure by arrivals", () => {
    const s = summariseRows([
      row({ routeId: "A", events: 300, on_time_pct: 60 }),
      row({ routeId: "B", events: 100, on_time_pct: 100 }),
    ]);
    expect(s.events).toBe(400);
    expect(s.on_time_pct).toBe(70);
  });

  it("leaves a row with no figure out of that figure's mean", () => {
    const s = summariseRows([
      row({ routeId: "A", events: 100, on_time_pct: 80 }),
      row({ routeId: "B", events: 100, on_time_pct: null }),
    ]);
    expect(s.events).toBe(200);
    expect(s.on_time_pct).toBe(80);
  });
});
