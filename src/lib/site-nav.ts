// src/lib/site-nav.ts
// Top-bar sections: which one a path belongs to, and the link to each that keeps
// the reader's day, window and mode filter, which the Overview, Routes and
// Cancellations pages (and the route, stop and shame pages under them) read the same way.
import { buildHref } from "@/lib/utils";

/** A top-bar section. */
export interface NavSection {
  href: "/" | "/routes" | "/cancellations";
  label: string;
  /** Path prefixes that belong to the section besides its own page. */
  under: readonly string[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  { href: "/", label: "Overview", under: ["/shame"] },
  { href: "/routes", label: "Routes", under: ["/route/", "/stop/"] },
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
 * The link to a section, carrying the current day, window, period and mode.
 * @param section - The section.
 * @param params - The current URL's query params.
 * @returns The href.
 */
export function navHref(section: NavSection, params: URLSearchParams): string {
  return buildHref(section.href, Object.fromEntries(CARRIED.map((k) => [k, params.get(k)])));
}
