import { deriveBoards } from "@/lib/rankings";
import type { TopRouteRow } from "@/types/api";
import { describe, expect, it } from "vitest";

/**
 * Build a TopRouteRow for tests with sensible defaults.
 * @param p - Field overrides; `route_id` is required.
 * @returns A complete row.
 */
function row(p: Partial<TopRouteRow> & { route_id: string }): TopRouteRow {
  return {
    short_name: p.route_id,
    long_name: `Route ${p.route_id}`,
    mode: "BUS",
    events: 100,
    avg_delay_sec: 0,
    avg_abs_delay_sec: 0,
    on_time_pct: 90,
    ...p,
  } as TopRouteRow;
}

describe("deriveBoards", () => {
  const rows: TopRouteRow[] = [
    row({ route_id: "A", avg_delay_sec: 360, on_time_pct: 50, events: 100 }),
    row({ route_id: "B", avg_delay_sec: -240, on_time_pct: 70, events: 100 }),
    row({ route_id: "C", avg_delay_sec: 120, on_time_pct: 95, events: 100 }),
    row({ route_id: "D", avg_delay_sec: -600, on_time_pct: 99, events: 5 }), // below min
  ];

  it("latest is highest positive avg first, gated by minEvents", () => {
    const { latest } = deriveBoards(rows, { minEvents: 10 });
    expect(latest.map((r) => r.route_id)).toEqual(["A", "C", "B"]);
  });
  it("earliest is most-negative avg first, gated by minEvents", () => {
    const { earliest } = deriveBoards(rows, { minEvents: 10 });
    expect(earliest.map((r) => r.route_id)).toEqual(["B", "C", "A"]);
    expect(earliest.map((r) => r.route_id)).not.toContain("D"); // 5 events < 10
  });
  it("reliable is highest on_time_pct first, gated by minEvents", () => {
    const { reliable } = deriveBoards(rows, { minEvents: 10 });
    expect(reliable.map((r) => r.route_id)).toEqual(["C", "B", "A"]);
  });
  it("limits each board to size", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      row({ route_id: `R${i}`, avg_delay_sec: i * 10 }),
    );
    const { latest } = deriveBoards(many, { minEvents: 10, size: 10 });
    expect(latest).toHaveLength(10);
  });
});
