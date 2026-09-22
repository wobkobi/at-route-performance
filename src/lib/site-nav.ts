// src/lib/site-nav.ts
// Top-bar sections: which one a path belongs to, and the link to each that keeps
// the reader's day, window and mode filter, which the Overview, Routes and
// Cancellations pages (and the route, stop and shame pages under them) read the same way.
import { nzServiceDayString } from "@/lib/time";
import { buildHref } from "@/lib/utils";

/** A top-bar section. */
export interface NavSection {
  href: "/" | "/routes" | "/live" | "/cancellations";
  label: string;
  /** Path prefixes that belong to the section besides its own page. */
  under: readonly string[];
  /**
   * Params the link carries, when not the usual day, window, period and mode:
   * the live page is always now, so a day or window would mean nothing there.
   */
  carries?: readonly string[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  // `/vehicle/` too: a vehicle's page is not a prefix match of the list it opens from.
  { href: "/", label: "Overview", under: ["/shame", "/days", "/vehicles", "/vehicle/"] },
  { href: "/routes", label: "Routes", under: ["/route/", "/stop/"] },
  { href: "/live", label: "Live", under: [], carries: ["mode"] },
  { href: "/cancellations", label: "Cancellations", under: [] },
];

/**
 * Params every section reads with the same meaning. `dir` stays behind: it is
 * late or early on the Overview but a sort direction on Routes and a travel
 * direction on a route page.
 */
const CARRIED = ["window", "day", "period", "mode", "school"] as const;

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
    CARRIED.map((k) => [k, params.get(k)]),
  );
  if (carried.day == null) {
    const at = params.get("d");
    const dAt = at ? new Date(at) : null;
    if (dAt && !Number.isNaN(dAt.getTime())) {
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
 * The link to a section, carrying the current day, window, period and mode.
 * @param section - The section.
 * @param params - The current URL's query params.
 * @returns The href.
 */
export function navHref(section: NavSection, params: URLSearchParams): string {
  if (!section.carries) return carriedHref(section.href, params);
  const carried = carriedParams(params);
  return buildHref(
    section.href,
    Object.fromEntries(section.carries.map((k) => [k, carried[k] ?? null])),
  );
}
