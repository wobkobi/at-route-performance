// tests/lib/page/site-nav.test.ts
// Unit tests for the top-bar sections and the site directory.
import { isNavActive, NAV_SECTIONS, navHref, SITE_PAGES } from "@/lib/page/site-nav";
import { describe, expect, it } from "vitest";

/**
 * A section by its tab's link, so the tests hold however the tabs are ordered.
 * @param href - The section's own path.
 * @returns The section.
 */
function section(href: (typeof NAV_SECTIONS)[number]["href"]): (typeof NAV_SECTIONS)[number] {
  const found = NAV_SECTIONS.find((s) => s.href === href);
  if (!found) throw new Error(`no section ${href}`);
  return found;
}

const overview = section("/");
const routes = section("/routes");
const operators = section("/operators");
const vehicles = section("/vehicles");
const live = section("/live");
const shame = section("/shame/trip");
const cancellations = section("/cancellations");

describe("isNavActive", () => {
  it("puts the shame boards under Shame, route and stop pages under Routes, and each operator and vehicle under its list", () => {
    expect(isNavActive(overview, "/")).toBe(true);
    expect(isNavActive(overview, "/shame/trip")).toBe(false);
    expect(isNavActive(shame, "/shame")).toBe(true);
    expect(isNavActive(shame, "/shame/stop")).toBe(true);
    expect(isNavActive(shame, "/")).toBe(false);
    expect(isNavActive(overview, "/days")).toBe(false);
    expect(isNavActive(vehicles, "/vehicles")).toBe(true);
    expect(isNavActive(vehicles, "/vehicle/59018")).toBe(true);
    expect(isNavActive(overview, "/routes")).toBe(false);
    expect(isNavActive(routes, "/route/NX1/trip/abc")).toBe(true);
    expect(isNavActive(routes, "/stop/123")).toBe(true);
    expect(isNavActive(routes, "/operators")).toBe(false);
    expect(isNavActive(operators, "/operators")).toBe(true);
    expect(isNavActive(operators, "/operator/go-bus")).toBe(true);
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

  it("carries only the mode to the live page, which is always now", () => {
    const params = new URLSearchParams("window=week&period=2026-09-07&mode=TRAIN&school=1");
    expect(navHref(live, params)).toBe("/live?mode=TRAIN");
    expect(navHref(live, new URLSearchParams("day=2026-09-13"))).toBe("/live");
  });

  it("leaves page-specific params behind", () => {
    const params = new URLSearchParams("dir=1&tsort=late&q=nx&sort=off_by");
    expect(navHref(cancellations, params)).toBe("/cancellations");
  });
});

describe("SITE_PAGES", () => {
  it("lists every top-bar section, so the footer and the 404 page miss none", () => {
    const listed = new Set<string>(SITE_PAGES.map((p) => p.href));
    for (const s of NAV_SECTIONS) expect(listed).toContain(s.href);
  });

  it("follows the top bar's order", () => {
    const order = SITE_PAGES.map((p) => p.href).filter((h) =>
      NAV_SECTIONS.some((s) => s.href === h),
    );
    expect(order).toEqual(NAV_SECTIONS.map((s) => s.href));
  });

  it("carries what the matching tab carries", () => {
    const params = new URLSearchParams("day=2026-09-13&mode=TRAIN");
    for (const s of NAV_SECTIONS) {
      const page = SITE_PAGES.find((p) => p.href === s.href);
      expect(page && navHref(page, params)).toBe(navHref(s, params));
    }
  });
});
