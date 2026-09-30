// tests/lib/page/filter-params.test.ts
// The carried-param lists and their pickers: set strings only, first value of a
// repeat, and a window switch that keeps filters but resets the list length.
import {
  omitParams,
  pickParams,
  SECTION_PARAMS,
  SHOWN_PARAM,
  VEHICLE_LIST_PARAMS,
  VIEW_PARAMS,
} from "@/lib/page/filter-params";
import { SHAME_PARAMS } from "@/lib/page/shame";
import { describe, expect, it } from "vitest";

describe("pickParams", () => {
  it("keeps the named, non-empty string params in the order named", () => {
    const sp = { sort: "late", mode: "BUS", q: "", school: undefined, day: ["a", "b"] };
    expect(pickParams(sp, ["mode", "school", "sort", "q", "day"])).toEqual({
      mode: "BUS",
      sort: "late",
    });
  });

  it("reads a URL query, first value of a repeat", () => {
    const sp = new URLSearchParams("mode=BUS&mode=TRAIN&show=60&hours=7-9");
    expect(pickParams(sp, VEHICLE_LIST_PARAMS)).toEqual({ mode: "BUS", show: "60" });
  });
});

describe("omitParams", () => {
  it("drops the window and the list length but keeps filters, sort and search", () => {
    const sp = new URLSearchParams("window=week&period=2026-09-21&mode=BUS&sort=late&q=70&show=80");
    expect(omitParams(sp, [...VIEW_PARAMS, SHOWN_PARAM])).toEqual({
      mode: "BUS",
      sort: "late",
      q: "70",
    });
  });
});

describe("the carried lists", () => {
  it("share the date params, and none carries the overloaded dir", () => {
    for (const list of [SECTION_PARAMS, SHAME_PARAMS]) {
      expect(list).toEqual(expect.arrayContaining([...VIEW_PARAMS]));
      expect(list).not.toContain("dir");
    }
  });
});
