// tests/lib/warm.test.ts
// Unit tests for the nightly warm's page list and worker pool.
import { DAY_PAGES, forEachLimited, pageWarmPaths, WARM_DAYS } from "@/lib/warm";
import { describe, expect, it } from "vitest";

describe("pageWarmPaths", () => {
  it("covers every day page on each of the last WARM_DAYS days, newest first", () => {
    const paths = pageWarmPaths("2026-09-30");
    expect(paths).toHaveLength(WARM_DAYS * DAY_PAGES.length);
    expect(paths[0]).toBe("/?day=2026-09-30");
    expect(paths.at(-1)).toBe("/cancellations?day=2026-09-24");
    expect(paths).toContain("/shame/stop?day=2026-09-27");
    // Every page with a day stepper belongs here, /vehicles included.
    expect(paths).toContain("/vehicles?day=2026-09-27");
  });

  it("stops at the archive's first day", () => {
    const paths = pageWarmPaths("2026-09-12");
    expect(paths).toHaveLength(2 * DAY_PAGES.length);
    expect(paths.some((p) => p.endsWith("2026-09-10"))).toBe(false);
    expect(paths).toContain("/routes?day=2026-09-11");
  });
});

describe("forEachLimited", () => {
  it("runs every item once and never exceeds the limit", async () => {
    const seen: number[] = [];
    let inFlight = 0;
    let peak = 0;
    await forEachLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 8 - n));
      seen.push(n);
      inFlight -= 1;
    });
    expect(seen.toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it("copes with no items and a limit above the item count", async () => {
    const seen: string[] = [];
    /**
     * Record an item.
     * @param s - The item.
     * @returns A settled promise.
     */
    const record = (s: string): Promise<void> => {
      seen.push(s);
      return Promise.resolve();
    };
    await forEachLimited([], 4, record);
    await forEachLimited(["a"], 4, record);
    expect(seen).toEqual(["a"]);
  });
});
