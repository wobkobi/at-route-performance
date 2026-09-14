// src/lib/data/cache.test.ts
// Unit tests for the cache key state of a date-scoped aggregation.
import { cacheState } from "@/lib/data/cache";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

const START = Date.parse("2026-09-13T17:00:00Z");
const END = Date.parse("2026-09-14T17:00:00Z");
const RANGE = { start: new Date(START), end: new Date(END) };

describe("cacheState", () => {
  it("holds a summarised window under one key", () => {
    expect(cacheState(true, RANGE, 300, END + 86_400_000)).toBe("final");
  });

  it("gives a finished but unsummarised window its own key, apart from the live one", () => {
    expect(cacheState(false, RANGE, 300, END)).toBe("ended");
    expect(cacheState(false, RANGE, 300, END - 1)).toMatch(/^live-/);
  });

  it("moves a live window to a new key every TTL", () => {
    const a = cacheState(false, RANGE, 300, START + 60_000);
    const b = cacheState(false, RANGE, 300, START + 120_000);
    const c = cacheState(false, RANGE, 300, START + 60_000 + 300_000);
    // START sits on a five-minute boundary, so a and b share a bucket and c is the next.
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(cacheState(false, null, 300, START)).toMatch(/^live-/);
  });
});
