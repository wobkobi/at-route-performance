// tests/lib/page/hrefs.test.ts
// The entity link builders: slugged routes, encoded ids, dropped unset params,
// both `?d=` forms on a trip link, and a redirect that keeps the query.
import {
  hrefKeepingQuery,
  redirectKeepingQuery,
  routeHref,
  stopHref,
  tripHref,
  vehicleHref,
} from "@/lib/page/hrefs";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  /**
   * Stand-in for Next's redirect, which throws to unwind the render.
   * @param href - Where the page would be sent.
   */
  redirect: (href: string): never => {
    throw new Error(`REDIRECT ${href}`);
  },
}));

describe("routeHref", () => {
  it("links the slug, not the versioned id, and encodes it", () => {
    expect(routeHref("70-203")).toBe("/route/70");
    expect(routeHref("NX1")).toBe("/route/NX1");
    expect(routeHref("A B")).toBe("/route/A%20B");
  });

  it("drops unset params and keeps the rest in order", () => {
    expect(routeHref("70", { day: undefined, window: "week", period: null })).toBe(
      "/route/70?window=week",
    );
    expect(routeHref("70", { day: "2026-09-27", hours: "7-9" })).toBe(
      "/route/70?day=2026-09-27&hours=7-9",
    );
  });
});

describe("stopHref and vehicleHref", () => {
  it("encode the id and carry the day", () => {
    expect(stopHref("station:1420", { day: "2026-09-27" })).toBe(
      "/stop/station%3A1420?day=2026-09-27",
    );
    expect(stopHref("7021")).toBe("/stop/7021");
    expect(vehicleHref("15786", { day: undefined })).toBe("/vehicle/15786");
  });
});

describe("tripHref", () => {
  it("takes an instant or a service date as ?d=, first", () => {
    expect(tripHref("70-203", "t1", "2026-09-27T07:05:00.000Z", { tsort: "late" })).toBe(
      "/route/70/trip/t1?d=2026-09-27T07%3A05%3A00.000Z&tsort=late",
    );
    expect(tripHref("70", "t1", "2026-09-27")).toBe("/route/70/trip/t1?d=2026-09-27");
    expect(tripHref("70", "t1", null)).toBe("/route/70/trip/t1");
  });
});

describe("hrefKeepingQuery", () => {
  it("keeps string params, drops the named ones and appends the added", () => {
    const sp = { day: "2026-09-01", mode: "BUS", ids: ["a", "b"], school: undefined };
    expect(hrefKeepingQuery("/stop/1", sp)).toBe("/stop/1?day=2026-09-01&mode=BUS");
    expect(hrefKeepingQuery("/stop/1", sp, ["day"], { day: "2026-09-11" })).toBe(
      "/stop/1?mode=BUS&day=2026-09-11",
    );
  });

  it("redirects to the same URL", () => {
    expect(() => redirectKeepingQuery("/route/NX1", { dir: "0" })).toThrow(
      "REDIRECT /route/NX1?dir=0",
    );
  });
});
