// src/lib/cron/warm.ts
// What the nightly warm renders, and the small worker pool it renders them with.
import { SITE_PAGES, type SitePage } from "@/lib/page/site-nav";
import { isBeforeDataStart } from "@/lib/time/data-start";
import { shiftDays } from "@/lib/time/service-day";
import { buildHref } from "@/lib/utils";

/**
 * Pages with a day stepper. Each is warmed on its default filters, the variant
 * a reader lands on and steps through.
 */
export const DAY_PAGES: readonly string[] = SITE_PAGES.filter(
  (p: SitePage) => p.takesDay === true,
).map((p) => p.href);

/** Completed service days the page warm covers, counting back from yesterday. */
export const WARM_DAYS = 7;

/**
 * The home page's week and month views on their default period. Both move to a
 * new range at the 4am service-day change, and a cold month is the slowest page
 * on the site, so each is rendered once the day has turned.
 */
export const PERIOD_PATHS: readonly string[] = ["/?window=week", "/?window=month"];

/**
 * The page paths to warm: the {@link PERIOD_PATHS} first, then every day page at
 * each completed day from yesterday back {@link WARM_DAYS}, never before the
 * archive starts. Newest day first: yesterday is the one readers step onto most,
 * and run after 4am it has only just ended, so nothing has read it as a past day.
 * The day before it is next, cold under the new key its nightly summary moved it to.
 * @param yesterday - The most recently completed service date (`YYYY-MM-DD`).
 * @returns Root-relative paths; each day page carries its `?day=`.
 */
export function pageWarmPaths(yesterday: string): string[] {
  const days = Array.from({ length: WARM_DAYS }, (_, i) => shiftDays(yesterday, -i)).filter(
    (day) => !isBeforeDataStart(day),
  );
  return [
    ...PERIOD_PATHS,
    ...days.flatMap((day) => DAY_PAGES.map((page) => buildHref(page, { day }))),
  ];
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
