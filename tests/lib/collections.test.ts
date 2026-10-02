// tests/lib/collections.test.ts
// Grouping, tallying and the two median rules.
import { addTo, countBy, groupBy, median, pushTo, sumBy } from "@/lib/collections";
import { describe, expect, it } from "vitest";

describe("pushTo and addTo", () => {
  it("start a key on first use and extend it after", () => {
    const lists = new Map<string, number[]>();
    pushTo(lists, "a", 1);
    pushTo(lists, "a", 2);
    pushTo(lists, "b", 3);
    expect([...lists]).toEqual([
      ["a", [1, 2]],
      ["b", [3]],
    ]);

    const totals = new Map<string, number>();
    addTo(totals, "a");
    addTo(totals, "a", 4);
    expect(totals.get("a")).toBe(5);
  });
});

describe("groupBy, countBy and sumBy", () => {
  const rows = [
    { mode: "BUS", events: 10 },
    { mode: "TRAIN", events: 3 },
    { mode: "BUS", events: 5 },
  ];

  it("group in input order, keys in first-seen order", () => {
    const groups = groupBy(rows, (r) => r.mode);
    expect([...groups.keys()]).toEqual(["BUS", "TRAIN"]);
    expect(groups.get("BUS")?.map((r) => r.events)).toEqual([10, 5]);
  });

  it("count one each, or total a figure", () => {
    expect(countBy(rows, (r) => r.mode).get("BUS")).toBe(2);
    expect(
      sumBy(
        rows,
        (r) => r.mode,
        (r) => r.events,
      ).get("BUS"),
    ).toBe(15);
  });
});

describe("median", () => {
  it("takes the middle of an odd list, in any input order", () => {
    expect(median([9, 1, 5])).toBe(5);
  });

  it("means the two middles of an even list, or takes the upper", () => {
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([1, 2, 3, 10], "upper")).toBe(3);
  });

  it("is null for an empty list", () => {
    expect(median([])).toBeNull();
  });
});
