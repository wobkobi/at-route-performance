import {
  keepSort,
  parseTableSort,
  sortParams,
  sortRows,
  tableSort,
  type SortColumn,
} from "@/lib/page/table-sort";
import { describe, expect, it } from "vitest";

interface Row {
  name: string;
  runs: number;
  off: number | null;
}

const COLUMNS: SortColumn<Row>[] = [
  { key: "name", value: "name", first: "asc" },
  { key: "runs", value: "runs" },
  { key: "off", value: "off" },
];

const ROWS: Row[] = [
  { name: "NX2", runs: 3, off: 40 },
  { name: "NX10", runs: 9, off: null },
  { name: "70", runs: 3, off: 120 },
];

describe("parseTableSort", () => {
  it("takes a column's first-click direction, flipped by rev", () => {
    expect(parseTableSort("name", undefined, COLUMNS, "runs")).toEqual({ key: "name", dir: "asc" });
    expect(parseTableSort("runs", "1", COLUMNS, "runs")).toEqual({ key: "runs", dir: "asc" });
  });

  it("falls back to the default column for an unknown or missing key", () => {
    expect(parseTableSort("bogus", undefined, COLUMNS, "runs")).toEqual({
      key: "runs",
      dir: "desc",
    });
    expect(parseTableSort(undefined, undefined, COLUMNS, null)).toBeNull();
  });
});

describe("sortRows", () => {
  it("sorts names numerically and keeps ties in their incoming order", () => {
    const byName = sortRows(ROWS, COLUMNS, { key: "name", dir: "asc" }).map((r) => r.name);
    expect(byName).toEqual(["70", "NX2", "NX10"]);
    const byRuns = sortRows(ROWS, COLUMNS, { key: "runs", dir: "desc" }).map((r) => r.name);
    expect(byRuns).toEqual(["NX10", "NX2", "70"]);
  });

  it("puts nulls last in both directions", () => {
    for (const dir of ["asc", "desc"] as const) {
      expect(sortRows(ROWS, COLUMNS, { key: "off", dir }).at(-1)?.name).toBe("NX10");
    }
  });

  it("keeps pinned rows at the bottom whatever the sort", () => {
    const rows = sortRows(ROWS, COLUMNS, { key: "runs", dir: "desc" }, (r) => r.name === "NX10");
    expect(rows.map((r) => r.name)).toEqual(["NX2", "70", "NX10"]);
  });

  it("leaves the order alone with no sort, and does not mutate its input", () => {
    const input = [...ROWS];
    expect(sortRows(input, COLUMNS, null)).toEqual(ROWS);
    sortRows(input, COLUMNS, { key: "name", dir: "asc" });
    expect(input).toEqual(ROWS);
  });
});

describe("sortParams", () => {
  it("flips the active column and starts others in their first direction", () => {
    const active = { key: "runs" as const, dir: "desc" as const };
    expect(sortParams(active, "runs", COLUMNS, "runs")).toEqual({ sort: "runs", rev: "1" });
    expect(sortParams(active, "name", COLUMNS, "runs")).toEqual({ sort: "name", rev: undefined });
  });

  it("drops both params for the default column in its first direction", () => {
    const flipped = { key: "runs" as const, dir: "asc" as const };
    expect(sortParams(flipped, "runs", COLUMNS, "runs")).toEqual({
      sort: undefined,
      rev: undefined,
    });
  });

  it("uses a table's own param names", () => {
    const names = { sort: "tsort", rev: "trev" };
    expect(sortParams(null, "off", COLUMNS, "runs", names)).toEqual({
      tsort: "off",
      trev: undefined,
    });
  });
});

describe("keepSort", () => {
  it("reproduces a sort and drops an unknown key", () => {
    expect(keepSort({ sort: "off", rev: "1" }, COLUMNS, "runs")).toEqual({ sort: "off", rev: "1" });
    expect(keepSort({ sort: "bogus" }, COLUMNS, "runs")).toEqual({
      sort: undefined,
      rev: undefined,
    });
  });
});

describe("tableSort", () => {
  it("builds each heading's href and marks only the sorted column", () => {
    const { head } = tableSort({ sort: "name" }, COLUMNS, "runs", (p) =>
      new URLSearchParams(
        Object.entries(p).filter((e): e is [string, string] => e[1] !== undefined),
      ).toString(),
    );
    expect(head("name")).toEqual({ href: "sort=name&rev=1", dir: "asc" });
    expect(head("runs")).toEqual({ href: "", dir: null });
  });
});
