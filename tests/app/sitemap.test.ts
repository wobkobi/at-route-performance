// tests/app/sitemap.test.ts
// Unit tests for sitemap.xml: the canonical set only, route versions collapsed to
// one URL each, and a build with no database still answering.
import sitemap from "@/app/sitemap";
import { getDirectoryRoutes } from "@/lib/data";
import { crawlableOrigin } from "@/lib/site-url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data", () => ({ getDirectoryRoutes: vi.fn() }));
vi.mock("@/lib/site-url", () => ({ crawlableOrigin: vi.fn() }));

const mockedRoutes = vi.mocked(getDirectoryRoutes);
const mockedOrigin = vi.mocked(crawlableOrigin);

const ORIGIN = "https://example.test";

/**
 * A directory row with only the field the sitemap reads.
 * @param id - The route id, version suffix and all.
 * @returns The row.
 */
function row(id: string): Awaited<ReturnType<typeof getDirectoryRoutes>>[number] {
  return { id, shortName: null, longName: null, mode: "BUS", colour: null };
}

beforeEach(() => {
  mockedOrigin.mockReturnValue(ORIGIN);
  mockedRoutes.mockReset();
});

describe("sitemap", () => {
  it("lists one URL per route, with feed versions collapsed", async () => {
    // Route ids carry a -NNN feed version that the site's own links strip. Listing
    // both would advertise two URLs for one page as duplicate content.
    mockedRoutes.mockResolvedValue([row("NX1-203"), row("NX1-204"), row("82-17")]);
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain(`${ORIGIN}/route/NX1`);
    expect(urls).toContain(`${ORIGIN}/route/82`);
    expect(urls).not.toContain(`${ORIGIN}/route/NX1-203`);
    expect(urls.filter((u) => u.startsWith(`${ORIGIN}/route/`))).toHaveLength(2);
  });

  it("advertises the canonical sections and no redirect-only page", async () => {
    mockedRoutes.mockResolvedValue([]);
    const urls = (await sitemap()).map((e) => e.url);
    for (const path of ["/", "/routes", "/live", "/cancellations", "/days", "/vehicles"]) {
      expect(urls).toContain(`${ORIGIN}${path}`);
    }
    // Both only redirect, so listing them advertises a 307 rather than a page.
    expect(urls).not.toContain(`${ORIGIN}/shame`);
    expect(urls).not.toContain(`${ORIGIN}/rankings`);
  });

  it("advertises nothing robots.txt disallows", async () => {
    // The two files have to agree: a URL listed here and disallowed there is a
    // crawl error reported back in Search Console.
    mockedRoutes.mockResolvedValue([row("NX1-203")]);
    for (const { url } of await sitemap()) {
      expect(url).not.toContain("?");
      expect(url).not.toMatch(/\/route\/[^/]+\/trip\//);
      expect(url).not.toMatch(/\/vehicle\//);
    }
  });

  it("still answers when the database cannot be reached, and says so in the log", async () => {
    // The root layout skips static generation so a build needs no DATABASE_URL;
    // throwing here would put that back and take the build with it. Degrading
    // quietly was the other half of the problem: a sitemap that lost its 532
    // routes looked the same as one that never had them.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRoutes.mockRejectedValue(new Error("Can't reach database server"));
    const entries = await sitemap();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => !e.url.includes("/route/"))).toBe(true);
    expect(spy.mock.calls[0]?.[0]).toContain("[DB-READ-FAILED]");
    spy.mockRestore();
  });
});
