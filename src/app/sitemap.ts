// src/app/sitemap.ts
// The canonical URLs worth crawling. Pairs with robots.ts: that file shuts the
// filter permutations out, and this one gives a crawler the list it would
// otherwise go looking for, so shutting the door does not send it exploring.

import { getDirectoryRoutes } from "@/lib/data";
import { routeSlug } from "@/lib/route-slug";
import { crawlableOrigin } from "@/lib/site-url";
import type { MetadataRoute } from "next";

/**
 * The sections, with priority relative to each other.
 *
 * `/shame` and `/rankings` are left out on purpose: both only redirect, so
 * listing them would advertise a URL that answers 307 rather than a page. Stops
 * are left out too - there are some 6,800 of them, and listing every one would
 * invite exactly the crawl this is meant to avoid. They stay reachable from a
 * route page, and allowed in robots.txt, just not advertised.
 */
const SECTIONS: readonly [path: string, priority: number][] = [
  ["/", 1],
  ["/routes", 0.9],
  ["/live", 0.8],
  ["/cancellations", 0.7],
  ["/shame/trip", 0.7],
  ["/shame/route", 0.6],
  ["/shame/stop", 0.6],
  ["/days", 0.6],
  ["/vehicles", 0.5],
];

/**
 * Generate sitemap.xml: the sections, then one page per current route.
 *
 * Route ids carry a feed-version suffix that the site's own links strip, so the
 * slugs are deduplicated - several ids for one route would otherwise be listed
 * as several pages of duplicate content.
 * @returns The canonical URLs.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = crawlableOrigin();
  const sections: MetadataRoute.Sitemap = SECTIONS.map(([path, priority]) => ({
    url: `${origin}${path}`,
    changeFrequency: path === "/live" ? "hourly" : "daily",
    priority,
  }));

  // A build with no database reachable still has to answer here, and the sections
  // are worth listing without the routes. Failing instead would take the build
  // with it, which is why the root layout skips static generation in the first place.
  let slugs: string[];
  try {
    slugs = [...new Set((await getDirectoryRoutes()).map((r) => routeSlug(r.id)))].sort();
  } catch {
    return sections;
  }

  return [
    ...sections,
    ...slugs.map((slug) => ({
      url: `${origin}/route/${encodeURIComponent(slug)}`,
      changeFrequency: "daily" as const,
      priority: 0.5,
    })),
  ];
}
