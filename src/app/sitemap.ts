// src/app/sitemap.ts
// The canonical URLs worth crawling. Pairs with robots.ts: that file shuts the
// filter permutations out, and this one gives a crawler the list it would
// otherwise go looking for, so shutting the door does not send it exploring.

import { getDirectoryRoutes, getOperators } from "@/lib/data";
import { logReadFailure } from "@/lib/db";
import { operatorHref } from "@/lib/operators";
import { routeHref } from "@/lib/page/hrefs";
import { SITE_PAGES } from "@/lib/page/site-nav";
import { routeSlug } from "@/lib/route/slug";
import { siteOrigin } from "@/lib/site-url";
import type { MetadataRoute } from "next";

/**
 * Each site page's priority relative to the others. Keyed by every page in
 * {@link SITE_PAGES}, so a new page fails the type check until it has one.
 *
 * `/shame` is not a site page: it only redirects, so listing it would
 * advertise a URL that answers 307 rather than a page. Stops
 * are left out too - there are some 6,800 of them, and listing every one would
 * invite exactly the crawl this is meant to avoid. They stay reachable from a
 * route page, and allowed in robots.txt, just not advertised.
 */
const PRIORITY: Record<(typeof SITE_PAGES)[number]["href"], number> = {
  "/": 1,
  "/routes": 0.9,
  "/live": 0.8,
  "/alerts": 0.6,
  "/cancellations": 0.7,
  "/shame/trip": 0.7,
  "/shame/route": 0.6,
  "/shame/stop": 0.6,
  "/days": 0.6,
  "/vehicles": 0.5,
  "/operators": 0.5,
  "/compare": 0.4,
};

/**
 * Generate sitemap.xml: the sections, the current operators, then one page per current route.
 *
 * Route ids carry a feed-version suffix that the site's own links strip, so the
 * slugs are deduplicated - several ids for one route would otherwise be listed
 * as several pages of duplicate content.
 * @returns The canonical URLs.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();
  const sections: MetadataRoute.Sitemap = [
    ...SITE_PAGES.map(({ href }) => ({
      url: `${origin}${href}`,
      changeFrequency: href === "/live" ? ("hourly" as const) : ("daily" as const),
      priority: PRIORITY[href],
    })),
  ];

  // Only the operators AT still lists: a dropped one's page stays up for its
  // routes' history, but is not advertised.
  try {
    for (const op of await getOperators()) {
      if (!op.current) continue;
      sections.push({
        url: `${origin}${operatorHref(op)}`,
        changeFrequency: "daily",
        priority: 0.4,
      });
    }
  } catch (err) {
    logReadFailure("sitemap-operators", err);
  }

  // A build with no database reachable still has to answer here, and the sections
  // are worth listing without the routes. Failing instead would take the build
  // with it, which is why the root layout skips static generation in the first place.
  let slugs: string[];
  try {
    slugs = [...new Set((await getDirectoryRoutes()).map((r) => routeSlug(r.routeId)))].sort();
  } catch (err) {
    logReadFailure("sitemap-routes", err);
    return sections;
  }

  return [
    ...sections,
    ...slugs.map((slug) => ({
      url: `${origin}${routeHref(slug)}`,
      changeFrequency: "daily" as const,
      priority: 0.5,
    })),
  ];
}
