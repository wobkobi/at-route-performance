// src/app/robots.ts
// What a crawler may fetch. Every page renders against the self-hosted database,
// so the filter permutations matter more here than on a static site: one route
// page multiplies by day, window, mode, direction, part of day, sort and page,
// and each combination is a distinct URL and a distinct uncached render.

import { crawlableOrigin, isProductionDeployment } from "@/lib/site-url";
import type { MetadataRoute } from "next";

/**
 * Agents that take content without sending readers: model training, answer
 * engines, and backlink indexes. Disallowed wholesale, which is not the same as
 * blocking search - Googlebot and Bingbot are still welcome below, and the two
 * `-Extended` agents here are the training opt-outs that do not affect either
 * one's search indexing.
 */
const NON_READER_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "meta-externalagent",
  "Bytespider",
  "Amazonbot",
  "AhrefsBot",
  "SemrushBot",
  "MJ12bot",
  "DotBot",
];

/**
 * Paths no crawler should walk, for load rather than secrecy.
 *
 * `/*?` is the one that counts: it drops the whole filter permutation space,
 * taking the crawlable site from a combinatorial explosion down to the canonical
 * pages the sitemap lists. Wildcards are an extension rather than part of the
 * standard, honoured by Google, Bing and Yandex and ignored by the rest, which
 * is the right way round - the agents that ignore them are the ones the caching
 * work has to stop instead.
 */
const COSTLY_PATHS = [
  // Any URL carrying a query string, so no filtered or paged view is crawled.
  "/*?",
  // One page per run of every trip, the most expensive render on the site.
  "/route/*/trip/",
  // One page per vehicle, useful to a reader who has one in mind, not to an index.
  "/vehicle/",
  "/api/",
];

/**
 * Generate robots.txt.
 * @returns The rules, and where to find the sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = crawlableOrigin();

  // A preview deployment answers on its own public URL, so letting it be indexed
  // would put a throwaway build in search results beside the real site.
  if (!isProductionDeployment()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: COSTLY_PATHS },
      { userAgent: NON_READER_AGENTS, disallow: "/" },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
