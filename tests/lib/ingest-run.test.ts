// tests/lib/ingest-run.test.ts
// Unit tests for the footer's freshness resolver.
import { INGEST_INTERVAL_SEC, resolveFreshness } from "@/lib/ingest-run";
import { describe, expect, it, vi } from "vitest";

// The module reads the database for the run and the latest arrival; the resolver itself is pure.
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/data", () => ({ getLatestEventDate: vi.fn() }));
vi.mock("@/lib/mem-cache", () => ({ memCache: vi.fn() }));

const now = new Date("2026-09-13T08:00:00Z");

describe("resolveFreshness", () => {
  it("prefers the last successful run and projects the next one a cadence later", () => {
    const completedAt = new Date("2026-09-13T07:58:30Z");
    expect(
      resolveFreshness({ completedAt, count: 1600 }, new Date("2026-09-13T07:59:00Z"), now),
    ).toEqual({
      lastUpdated: completedAt,
      nextUpdate: new Date(completedAt.getTime() + INGEST_INTERVAL_SEC * 1000),
      source: "run",
    });
  });

  it("accepts a run whose instant was serialised to a string", () => {
    const run = { completedAt: "2026-09-13T07:58:30Z" as unknown as Date, count: null };
    expect(resolveFreshness(run, null, now)?.lastUpdated).toEqual(new Date("2026-09-13T07:58:30Z"));
  });

  it("falls back to the freshest arrival while no run is logged, marked as such", () => {
    const result = resolveFreshness(null, new Date("2026-09-13T07:50:00Z"), now);
    expect(result?.source).toBe("event");
    expect(result?.lastUpdated).toEqual(new Date("2026-09-13T07:50:00Z"));
  });

  it("clamps a scheduled arrival in the future to now", () => {
    const result = resolveFreshness(null, new Date("2026-09-13T09:30:00Z"), now);
    expect(result?.lastUpdated).toEqual(now);
    expect(result?.nextUpdate).toEqual(new Date(now.getTime() + INGEST_INTERVAL_SEC * 1000));
  });

  it("is null with neither a run nor an arrival", () => {
    expect(resolveFreshness(null, null, now)).toBeNull();
  });
});
