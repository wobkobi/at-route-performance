// src/lib/page/site-nav.ts
// Top-bar sections: which one a path belongs to, and the link to each that keeps
// the reader's day, window and mode filter, which the Overview, Routes, Shame and
// Cancellations pages (and the route and stop pages under them) read the same way.
import { SECTION_PARAMS } from "@/lib/page/filter-params";
import { nzServiceDayString, parseInstantParam } from "@/lib/time/service-day";
import { buildHref } from "@/lib/utils";

/** A top-bar section. */
export interface NavSection {
  href:
    | "/"
    | "/days"
    | "/routes"
    | "/operators"
    | "/vehicles"
    | "/live"
    | "/alerts"
    | "/shame/trip"
    | "/cancellations"
    | "/compare";
  label: string;
  /** Path prefixes that belong to the section besides its own page. */
  under: readonly string[];
  /**
   * Params the link carries, when not the usual day, window, period and mode:
   * the live page is always now, so a day or window would mean nothing there.
   */
  carries?: readonly string[];
}

/**
 * The top bar's tabs in three groups, shown apart: the network as a whole over
 * time (the day, the days before it, right now and its disruptions), the things it is made of
 * (routes, operators, vehicles), and the boards that pick out what went wrong,
 * with Compare beside them.
 */
export const NAV_GROUPS: readonly (readonly NavSection[])[] = [
  [
    { href: "/", label: "Overview", under: [] },
    { href: "/days", label: "Days", under: [] },
    { href: "/live", label: "Live", under: [], carries: ["mode"] },
    { href: "/alerts", label: "Alerts", under: [], carries: ["mode"] },
  ],
  [
    { href: "/routes", label: "Routes", under: ["/route/", "/stop/"] },
    // A single operator's or vehicle's page is not a prefix match of the list it
    // opens from (`/operator/` against `/operators`), so each is listed.
    { href: "/operators", label: "Operators", under: ["/operator/"] },
    { href: "/vehicles", label: "Vehicles", under: ["/vehicle/"] },
  ],
  [
    // The section's own tab: /shame redirects here, and the other two boards sit beside it.
    { href: "/shame/trip", label: "Shame", under: ["/shame"] },
    { href: "/cancellations", label: "Cancellations", under: [] },
    { href: "/compare", label: "Compare", under: [] },
  ],
];

/** Every top-bar tab, in order. */
export const NAV_SECTIONS: readonly NavSection[] = NAV_GROUPS.flat();

/** A page in the site directory. */
export interface SitePage {
  href: string;
  label: string;
  /** As {@link NavSection.carries}: the params the link carries, when not the usual ones. */
  carries?: readonly string[];
  /** Whether the page has a day stepper (`?day=`), so the nightly warm renders its past days. */
  takesDay?: boolean;
}

/**
 * Every page a reader can go to, in top-bar order: the footer's Explore list,
 * the 404 page's directory, the sitemap's sections and the nightly warm's pages. It differs from {@link NAV_SECTIONS} only in giving
 * the three worst-of boards one entry each where the top bar has a single Shame
 * tab, and in spelling out the three short tab labels.
 */
export const SITE_PAGES = [
  { href: "/", label: "Overview", takesDay: true },
  { href: "/days", label: "Day by day" },
  { href: "/live", label: "Live now", carries: ["mode"] },
  { href: "/alerts", label: "Service alerts", carries: ["mode"] },
  { href: "/routes", label: "Routes", takesDay: true },
  { href: "/operators", label: "Operators", takesDay: true },
  { href: "/vehicles", label: "Vehicles", takesDay: true },
  { href: "/shame/trip", label: "Worst trips", takesDay: true },
  { href: "/shame/route", label: "Worst routes", takesDay: true },
  { href: "/shame/stop", label: "Worst stops", takesDay: true },
  { href: "/cancellations", label: "Cancellations", takesDay: true },
  { href: "/compare", label: "Compare", takesDay: true },
] as const satisfies readonly SitePage[];

/**
 * Whether a path belongs to a section.
 * @param section - The section.
 * @param pathname - The current path.
 * @returns True when the section's tab is the active one.
 */
export function isNavActive(section: NavSection, pathname: string): boolean {
  if (pathname === section.href) return true;
  if (section.href !== "/" && pathname.startsWith(`${section.href}/`)) return true;
  return section.under.some((p) => pathname.startsWith(p));
}

/**
 * The day, window, period and mode a link should carry out of the current URL.
 * A trip page holds its day as `?d`, an instant rather than a service day, so it
 * is translated here: without that, every link off a trip page silently lands on
 * today. A `?d` that is already today is left off, since the pages redirect a
 * `?day=<today>` away again.
 * @param params - The current URL's query params.
 * @returns The params to carry, null for each one not set.
 */
export function carriedParams(params: URLSearchParams): Record<string, string | null> {
  const carried: Record<string, string | null> = Object.fromEntries(
    SECTION_PARAMS.map((k) => [k, params.get(k)]),
  );
  if (carried.day == null) {
    const dAt = parseInstantParam(params.get("d"));
    if (dAt) {
      const day = nzServiceDayString(dAt);
      if (day !== nzServiceDayString()) carried.day = day;
    }
  }
  return carried;
}

/**
 * A link to any site path, carrying the reader's day, window, period and mode.
 * @param path - The path to link to.
 * @param params - The current URL's query params.
 * @returns The href.
 */
export function carriedHref(path: string, params: URLSearchParams): string {
  return buildHref(path, carriedParams(params));
}

/**
 * The link to a section or directory page, carrying the current day, window,
 * period and mode, or only the params it names in `carries`.
 * @param section - The section or page.
 * @param params - The current URL's query params.
 * @returns The href.
 */
export function navHref(section: SitePage, params: URLSearchParams): string {
  if (!section.carries) return carriedHref(section.href, params);
  const carried = carriedParams(params);
  return buildHref(
    section.href,
    Object.fromEntries(section.carries.map((k) => [k, carried[k] ?? null])),
  );
}
