// tests/app/robots.test.ts
// Unit tests for robots.txt: search engines stay welcome, the filter permutation
// space does not, and a preview deployment keeps out of the index entirely.
import robots from "@/app/robots";
import { crawlableOrigin, isProductionDeployment } from "@/lib/site-url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/site-url", () => ({
  crawlableOrigin: vi.fn(),
  isProductionDeployment: vi.fn(),
}));

const mockedOrigin = vi.mocked(crawlableOrigin);
const mockedIsProduction = vi.mocked(isProductionDeployment);

const ORIGIN = "https://example.test";

/**
 * The rules as an array, whatever shape the single-or-many union came back as.
 * @returns The rule list.
 */
function rules(): { userAgent?: string | string[]; allow?: unknown; disallow?: unknown }[] {
  const { rules: r } = robots();
  return Array.isArray(r) ? r : [r];
}

beforeEach(() => {
  mockedOrigin.mockReturnValue(ORIGIN);
  mockedIsProduction.mockReturnValue(true);
});

describe("robots", () => {
  it("shuts out the query-string permutations, which is the rule that matters", () => {
    // One route page multiplies by day, window, mode, direction, part of day,
    // sort and page. Without this the crawlable site is combinatorial.
    const general = rules().find((r) => r.userAgent === "*");
    expect(general?.allow).toBe("/");
    expect(general?.disallow).toContain("/*?");
    expect(general?.disallow).toContain("/route/*/trip/");
    expect(general?.disallow).toContain("/vehicle/");
  });

  it("leaves the canonical pages crawlable", () => {
    const general = rules().find((r) => r.userAgent === "*");
    const disallow = general?.disallow as string[];
    // A disallow entry that would swallow a page the sitemap advertises.
    for (const path of ["/", "/routes", "/live", "/days", "/vehicles", "/shame/trip"]) {
      expect(disallow).not.toContain(path);
    }
    expect(disallow).not.toContain("/route/");
    expect(disallow).not.toContain("/stop/");
  });

  it("keeps the search engines that send readers", () => {
    // The whole point of the split: blocking scrapers must not block search, or
    // nobody finds the site. Googlebot and Bingbot are named nowhere, so they
    // fall under the permissive `*` rule.
    const blocked = rules().flatMap((r) =>
      Array.isArray(r.userAgent) ? r.userAgent : r.userAgent ? [r.userAgent] : [],
    );
    for (const agent of ["Googlebot", "Bingbot", "DuckDuckBot", "Applebot"]) {
      expect(blocked).not.toContain(agent);
    }
    // The -Extended agents are training opt-outs and do not affect search.
    expect(blocked).toContain("Google-Extended");
    expect(blocked).toContain("Applebot-Extended");
  });

  it("turns the scrapers away wholesale", () => {
    const scrapers = rules().find((r) => Array.isArray(r.userAgent));
    expect(scrapers?.userAgent).toContain("GPTBot");
    expect(scrapers?.disallow).toBe("/");
  });

  it("points at the sitemap, so the allowed set is a list and not a search", () => {
    expect(robots().sitemap).toBe(`${ORIGIN}/sitemap.xml`);
  });

  it("keeps a preview deployment out of the index altogether", () => {
    // A preview answers on its own public URL, so an indexed one competes with
    // the real site under a build nobody meant to publish.
    mockedIsProduction.mockReturnValue(false);
    const { rules: r, sitemap } = robots();
    expect(Array.isArray(r) ? r : [r]).toEqual([{ userAgent: "*", disallow: "/" }]);
    expect(sitemap).toBeUndefined();
  });
});
