// tests/lib/route-lineage.test.ts
// Unit tests for the CRL train-line succession map, the directory trim and the
// ranking-row fold in route-lineage.ts.
import {
  allSuccessorSlugs,
  directoryLineageRows,
  foldLineageRows,
  predecessorSlugs,
  successorSlug,
} from "@/lib/route-lineage";
import type { TopRouteRow } from "@/types/api";
import { describe, expect, it } from "vitest";

/**
 * A ranking row with the averaged fields defaulted, so a test states only what it
 * checks.
 * @param route_id - Full route id.
 * @param events - Event count (the fold's weight).
 * @param over - Field overrides.
 * @returns The row.
 */
function row(route_id: string, events: number, over: Partial<TopRouteRow> = {}): TopRouteRow {
  return {
    route_id,
    short_name: route_id.replace(/-\d+$/, ""),
    long_name: `${route_id} line`,
    mode: "TRAIN",
    events,
    avg_delay_sec: 0,
    avg_abs_delay_sec: 0,
    on_time_pct: 0,
    ...over,
  };
}

describe("predecessorSlugs", () => {
  it("maps each CRL line back to the lines it replaces", () => {
    expect(predecessorSlugs("S-C")).toEqual(["STH"]);
    expect(predecessorSlugs("O-W")).toEqual(["ONE"]);
  });

  it("gives the merged line both of its predecessors", () => {
    expect(predecessorSlugs("E-W")).toEqual(["EAST", "WEST"]);
  });

  it("is case-insensitive, since URLs arrive in any case", () => {
    expect(predecessorSlugs("e-w")).toEqual(["EAST", "WEST"]);
  });

  it("recognises only the ids AT published, not a flattened spelling", () => {
    expect(predecessorSlugs("SC")).toEqual([]);
    expect(predecessorSlugs("EW")).toEqual([]);
  });

  it("leaves every other route alone", () => {
    expect(predecessorSlugs("STH")).toEqual([]);
    expect(predecessorSlugs("NX1")).toEqual([]);
    expect(predecessorSlugs("HUIA")).toEqual([]);
    expect(predecessorSlugs("501")).toEqual([]);
  });
});

describe("successorSlug", () => {
  it("names the line a retired slug moves to", () => {
    expect(successorSlug("STH")).toBe("S-C");
    expect(successorSlug("ONE")).toBe("O-W");
    expect(successorSlug("sth")).toBe("S-C");
  });

  it("sends both merged lines to the same successor", () => {
    expect(successorSlug("EAST")).toBe("E-W");
    expect(successorSlug("WEST")).toBe("E-W");
  });

  it("is null for lines that are not retired", () => {
    expect(successorSlug("S-C")).toBeNull();
    expect(successorSlug("HUIA")).toBeNull();
    expect(successorSlug("NX1")).toBeNull();
  });

  it("round-trips with predecessorSlugs", () => {
    for (const retired of ["STH", "EAST", "WEST", "ONE"]) {
      const successor = successorSlug(retired);
      if (successor === null) throw new Error(`${retired} has no successor`);
      expect(predecessorSlugs(successor)).toContain(retired);
    }
  });

  it("lists every successor for up-front state checks", () => {
    expect(allSuccessorSlugs()).toEqual(["S-C", "E-W", "O-W"]);
  });
});

describe("directoryLineageRows", () => {
  const rows = [
    { id: "STH-201" },
    { id: "S-C-201" },
    { id: "EAST-201" },
    { id: "WEST-201" },
    { id: "E-W-201" },
    { id: "NX1-201" },
  ];

  it("lists the retired lines and hides the successors before their first train", () => {
    expect(directoryLineageRows(rows, new Set()).map((r) => r.id)).toEqual([
      "STH-201",
      "EAST-201",
      "WEST-201",
      "NX1-201",
    ]);
  });

  it("swaps a retired line for its successor once the successor is running", () => {
    expect(directoryLineageRows(rows, new Set(["S-C"])).map((r) => r.id)).toEqual([
      "S-C-201",
      "EAST-201",
      "WEST-201",
      "NX1-201",
    ]);
  });

  it("hides both merged lines once the merged successor is running", () => {
    expect(directoryLineageRows(rows, new Set(["S-C", "E-W"])).map((r) => r.id)).toEqual([
      "S-C-201",
      "E-W-201",
      "NX1-201",
    ]);
  });
});

describe("foldLineageRows", () => {
  it("leaves rows alone before the cutover, when no successor row exists", () => {
    const sth = row("STH-201", 300, { avg_delay_sec: 60 });
    const nx1 = row("NX1-201", 500);
    const folded = foldLineageRows([sth, nx1]);
    expect(folded).toHaveLength(2);
    expect(folded[0]).toBe(sth);
    expect(folded[1]).toBe(nx1);
  });

  it("folds a retired line into its successor with event-weighted averages", () => {
    const folded = foldLineageRows([
      row("STH-201", 300, { avg_delay_sec: 60, avg_abs_delay_sec: 80, on_time_pct: 50 }),
      row("NX1-201", 500, { avg_delay_sec: 5 }),
      row("S-C-201", 100, {
        avg_delay_sec: 20,
        avg_abs_delay_sec: 40,
        on_time_pct: 90,
        long_name: "South-City Line",
        colour: "0A5",
      }),
    ]);
    expect(folded.map((r) => r.route_id)).toEqual(["S-C-201", "NX1-201"]);
    expect(folded[0]).toEqual({
      route_id: "S-C-201",
      short_name: "S-C",
      long_name: "South-City Line",
      mode: "TRAIN",
      colour: "0A5",
      events: 400,
      avg_delay_sec: 50,
      avg_abs_delay_sec: 70,
      on_time_pct: 60,
    });
    expect(folded[1]).toEqual(row("NX1-201", 500, { avg_delay_sec: 5 }));
  });

  it("folds both merged lines into the one successor", () => {
    const folded = foldLineageRows([
      row("EAST-201", 100, { avg_delay_sec: 10 }),
      row("WEST-201", 100, { avg_delay_sec: 30 }),
      row("E-W-201", 200, { avg_delay_sec: 50 }),
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.route_id).toBe("E-W-201");
    expect(folded[0]?.events).toBe(400);
    expect(folded[0]?.avg_delay_sec).toBe(35);
  });

  it("merges the feed versions of one route under the newest id", () => {
    const folded = foldLineageRows([
      row("501-217", 100, { avg_delay_sec: 10, on_time_pct: 80 }),
      row("501-218", 300, { avg_delay_sec: 30, on_time_pct: 60 }),
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.route_id).toBe("501-218");
    expect(folded[0]?.events).toBe(400);
    expect(folded[0]?.avg_delay_sec).toBe(25);
    expect(folded[0]?.on_time_pct).toBe(65);
  });

  it("names a folded lineage after the successor's newest version", () => {
    const folded = foldLineageRows([
      row("STH-205", 100),
      row("S-C-201", 100),
      row("S-C-202", 100, { long_name: "newest" }),
    ]);
    expect(folded[0]?.route_id).toBe("S-C-202");
    expect(folded[0]?.long_name).toBe("newest");
    expect(folded[0]?.events).toBe(300);
  });

  it("weights only the rows that carry a value, and keeps null when none do", () => {
    const folded = foldLineageRows([
      row("STH-201", 300, { avg_delay_sec: null, on_time_pct: null }),
      row("S-C-201", 100, { avg_delay_sec: 20, on_time_pct: null }),
    ]);
    expect(folded[0]?.avg_delay_sec).toBe(20);
    expect(folded[0]?.on_time_pct).toBeNull();
  });

  it("rounds to one decimal and leaves an absent optional field absent", () => {
    const folded = foldLineageRows([
      row("STH-201", 200, { avg_delay_sec: 10 }),
      row("S-C-201", 100, { avg_delay_sec: 20 }),
    ]);
    expect(folded[0]?.avg_delay_sec).toBe(13.3);
    expect(folded[0]).not.toHaveProperty("early_pct");
    expect(folded[0]).not.toHaveProperty("late_pct");
  });

  it("carries the optional percentages when the rows have them", () => {
    const folded = foldLineageRows([
      row("STH-201", 100, { early_pct: 10, late_pct: 30 }),
      row("S-C-201", 100, { early_pct: 20, late_pct: 10 }),
    ]);
    expect(folded[0]?.early_pct).toBe(15);
    expect(folded[0]?.late_pct).toBe(20);
  });
});
