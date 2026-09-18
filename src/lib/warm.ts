// src/lib/warm.ts
// What the nightly warm renders, and the small worker pool it renders them with.
import { isBeforeDataStart } from "@/lib/data-start";
import { shiftWeek } from "@/lib/time";

/**
 * Pages with a day stepper. Each is warmed on its default filters, the variant
 * a reader lands on and steps through.
 */
export const DAY_PAGES = [
  "/",
  "/shame",
  "/shame/trip",
  "/shame/route",
  "/shame/stop",
  "/routes",
  "/cancellations",
] as const;

/** Completed service days the page warm covers, counting back from yesterday. */
export const WARM_DAYS = 7;

/**
 * The page paths to warm: every day page at each completed day from yesterday
 * back {@link WARM_DAYS}, never before the archive starts. Newest day first: it
 * is the one readers step onto most, and the only one certain to be cold, since
 * its entries moved to a new key when its summary landed.
 * @param yesterday - The most recently completed service date (`YYYY-MM-DD`).
 * @returns Root-relative paths, each carrying its `?day=`.
 */
export function pageWarmPaths(yesterday: string): string[] {
  const days = Array.from({ length: WARM_DAYS }, (_, i) => shiftWeek(yesterday, -i)).filter(
    (day) => !isBeforeDataStart(day),
  );
  return days.flatMap((day) => DAY_PAGES.map((page) => `${page}?day=${day}`));
}

/**
 * Run a task over every item with at most `limit` in flight, in item order.
 * Each worker takes the next unclaimed item as it frees up, so one slow item
 * holds up only its own slot. A task that throws rejects the whole run, so a
 * caller that wants to carry on past a failure catches inside the task.
 * @param items - The work, claimed front to back.
 * @param limit - Tasks in flight at once (at least one).
 * @param task - Runs one item.
 */
export async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  /** Claim and run items until none are left. */
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await task(item);
    }
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
}
