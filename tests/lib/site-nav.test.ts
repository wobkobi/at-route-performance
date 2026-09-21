// tests/lib/site-nav.test.ts
// Unit tests for the top-bar sections.
import { isNavActive, NAV_SECTIONS, navHref } from "@/lib/site-nav";
import { describe, expect, it } from "vitest";

const [overview, routes, cancellations] = NAV_SECTIONS as [
  (typeof NAV_SECTIONS)[number],
  (typeof NAV_SECTIONS)[number],
  (typeof NAV_SECTIONS)[number],
];

describe("isNavActive", () => {
  it("puts the shame boards under Overview, and route and stop pages under Routes", () => {
    expect(isNavActive(overview, "/")).toBe(true);
    expect(isNavActive(overview, "/shame/trip")).toBe(true);
    expect(isNavActive(overview, "/days")).toBe(true);
    expect(isNavActive(overview, "/routes")).toBe(false);
    expect(isNavActive(routes, "/route/NX1/trip/abc")).toBe(true);
    expect(isNavActive(routes, "/stop/123")).toBe(true);
    expect(isNavActive(cancellations, "/cancellations")).toBe(true);
    expect(isNavActive(cancellations, "/")).toBe(false);
  });
});

describe("navHref", () => {
  it("carries the window, day and mode filters", () => {
    const params = new URLSearchParams("window=week&period=2026-09-07&mode=BUS&school=1");
    expect(navHref(routes, params)).toBe("/routes?window=week&period=2026-09-07&mode=BUS&school=1");
    expect(navHref(overview, new URLSearchParams("day=2026-09-13"))).toBe("/?day=2026-09-13");
  });

  it("leaves page-specific params behind", () => {
    const params = new URLSearchParams("dir=1&tsort=late&q=nx&sort=off_by");
    expect(navHref(cancellations, params)).toBe("/cancellations");
  });
});
