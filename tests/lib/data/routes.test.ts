// tests/lib/data/routes.test.ts
// Slug to route id resolution: the in-memory table of every route id, and the single-slug
// lookup for a slug the table does not hold.
import { ownRouteIds, routeIdsForSlug } from "@/lib/data/routes";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, memo } = vi.hoisted(() => ({
  findMany: vi.fn(),
  memo: new Map<string, Promise<unknown>>(),
}));

vi.mock("@/lib/db", () => ({ prisma: { route: { findMany } } }));
// memCache holds one table per test, as it does per process; unstable_cache runs its read uncached.
vi.mock("@/lib/mem-cache", () => ({
  /**
   * Run the read once per key and share its result.
   * @param key - The entry's key.
   * @param _ttl - Unused.
   * @param fn - The read.
   * @returns The key's shared result.
   */
  memCache: <T>(key: string, _ttl: number, fn: () => Promise<T>): Promise<T> => {
    if (!memo.has(key)) memo.set(key, fn());
    return memo.get(key) as Promise<T>;
  },
  /**
   * Hand back the read uncached.
   * @param fn - The read.
   * @returns The read.
   */
  unstable_cache: <T>(fn: () => Promise<T>): (() => Promise<T>) => fn,
}));

/** The table: two versions of 70, one of S-C and the line it replaced, and one of 700. */
const TABLE = ["70-201", "STH-201", "70-203", "S-C-203", "700-202"].map((id) => ({ id }));

beforeEach(() => {
  memo.clear();
  findMany.mockReset();
  findMany.mockImplementation(({ where }: { where?: unknown }) =>
    Promise.resolve(where ? [] : TABLE),
  );
});

describe("ownRouteIds", () => {
  it("gives a slug's ids newest version first, without a longer slug sharing its prefix", async () => {
    expect(await ownRouteIds("70")).toEqual(["70-203", "70-201"]);
  });

  it("reads one table for every slug rather than one query per slug", async () => {
    await Promise.all([ownRouteIds("70"), ownRouteIds("700"), ownRouteIds("S-C")]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({ select: { id: true } });
  });

  it("hands each caller its own copy of the table's list", async () => {
    const first = await ownRouteIds("70");
    first.push("junk");
    expect(await ownRouteIds("70")).toEqual(["70-203", "70-201"]);
  });

  it("looks a slug the table does not hold up on its own, and falls back to the input", async () => {
    expect(await ownRouteIds("70-203")).toEqual(["70-203"]);
    expect(findMany).toHaveBeenCalledWith({
      where: { OR: [{ id: "70-203" }, { id: { startsWith: "70-203-" } }] },
      select: { id: true },
    });
  });
});

describe("routeIdsForSlug", () => {
  it("puts the line's own ids before those of the line it replaced", async () => {
    expect(await routeIdsForSlug("S-C")).toEqual(["S-C-203", "STH-201"]);
  });
});
