// tests/app/api/routes/route.test.ts
// Handler test for GET /api/routes: the shared cache must not outlast the
// lineage trim the directory computes outside its own hourly cache.
import { GET } from "@/app/api/routes/route";
import { getDirectoryRoutes } from "@/lib/data";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data", () => ({ getDirectoryRoutes: vi.fn() }));

const mockedDirectory = vi.mocked(getDirectoryRoutes);

/** The revalidate `routeHasTraffic` holds its answer for, in seconds. */
const TRAFFIC_REVALIDATE_SEC = 600;

describe("GET /api/routes", () => {
  afterEach(() => {
    mockedDirectory.mockReset();
  });

  it("holds no longer than the lineage trim it carries", async () => {
    // `getDirectoryRoutes` deliberately runs the trim outside its hourly cache
    // because `routeHasTraffic` flips within ten minutes of a successor's first
    // train. An s-maxage above that hands a shared cache the staleness the data
    // layer went out of its way to avoid, and at the CRL cutover that means
    // listing a retired line beside the one replacing it.
    mockedDirectory.mockResolvedValue([]);
    const res = await GET();

    expect(res.status).toBe(200);
    const sMaxAge = /s-maxage=(\d+)/.exec(res.headers.get("Cache-Control") ?? "")?.[1];
    expect(sMaxAge).toBeDefined();
    expect(Number(sMaxAge)).toBeLessThanOrEqual(TRAFFIC_REVALIDATE_SEC);
  });

  it("keeps the browser off its own copy, so the trim is never cached per reader", async () => {
    mockedDirectory.mockResolvedValue([]);
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toContain("max-age=0");
  });
});
