// tests/lib/route/slug.test.ts
// Route slugs and names: the version suffix strip, the name and subtitle
// fallbacks every route row uses, and the one route-number sort.
import {
  compareRouteNumbers,
  routeDisplayName,
  routeSlug,
  routeSubtitle,
  shownRouteSlugs,
} from "@/lib/route/slug";
import { describe, expect, it } from "vitest";

describe("routeSlug", () => {
  it("strips the feed-version suffix", () => {
    expect(routeSlug("70-203")).toBe("70");
    expect(routeSlug("NX1")).toBe("NX1");
  });
});

describe("routeDisplayName", () => {
  it("prefers the short name, then the long name", () => {
    expect(routeDisplayName({ routeId: "70-203", shortName: "70", longName: "Botany" })).toBe("70");
    expect(routeDisplayName({ routeId: "70-203", shortName: "", longName: "Botany" })).toBe(
      "Botany",
    );
  });

  it("falls back to the slug, never the versioned id", () => {
    expect(routeDisplayName({ routeId: "70-203", shortName: null, longName: null })).toBe("70");
    expect(routeDisplayName({ slug: "70", shortName: null })).toBe("70");
  });
});

describe("routeSubtitle", () => {
  it("gives a train its line name over AT's bare code", () => {
    expect(
      routeSubtitle({ routeId: "STH-201", shortName: "STH", longName: "STH", mode: "TRAIN" }),
    ).toBe("Southern Line");
  });

  it("gives a bus its long name", () => {
    expect(
      routeSubtitle({
        routeId: "70-203",
        shortName: "70",
        longName: "Botany to Britomart",
        mode: "BUS",
      }),
    ).toBe("Botany to Britomart");
  });

  it("drops a subtitle that repeats the name", () => {
    expect(
      routeSubtitle({ slug: "X", shortName: null, longName: "Airport", mode: "BUS" }),
    ).toBeNull();
    expect(routeSubtitle({ slug: "X", shortName: "X", longName: "", mode: "BUS" })).toBeNull();
  });
});

describe("compareRouteNumbers", () => {
  it("sorts numbers numerically and suffixes after their base", () => {
    expect(["70X", "10", "2", "70", "NX1"].sort(compareRouteNumbers)).toEqual([
      "2",
      "10",
      "70",
      "70X",
      "NX1",
    ]);
  });
});

describe("shownRouteSlugs", () => {
  it("slugs the rows and adds the routes with only cancellations", () => {
    expect(
      shownRouteSlugs(
        [{ routeId: "70-203" }, { routeId: "70-210" }, { routeId: "NX1-203" }],
        ["33"],
      ),
    ).toEqual(new Set(["70", "NX1", "33"]));
  });
});
