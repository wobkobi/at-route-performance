// src/lib/at-versions.ts
// Resolves which GTFS feed version AT is currently publishing, from
// the GTFS v3 /versions endpoint. AT names the field `feed_version` (not
// `version`) and ships no `is_current` flag, so the live feed is identified by
// the `feed_start_date`/`feed_end_date` window that covers the service day.

import { getJson } from "@/lib/at-static";
import { unstable_cache } from "@/lib/mem-cache";
import { nzServiceDayString } from "@/lib/time";

/** Attributes for a single GTFS feed version entry from AT v3 `/versions`. */
export interface GtfsVersionAttr {
  /** The feed's version string, e.g. "VDV_EOD_118_2_F_315.0858...". */
  feed_version?: string | null;
  /** First service date the feed covers, as `YYYYMMDD`. */
  feed_start_date?: string | null;
  /** Last service date the feed covers, as `YYYYMMDD`. */
  feed_end_date?: string | null;
  /** Not sent by AT today; honoured if it ever appears. */
  is_current?: boolean;
  [key: string]: unknown;
}

/**
 * Pick the feed version covering a service date.
 *
 * The date window is ranked first because it is the only signal AT actually
 * publishes, and it is authoritative about which feed is live right now;
 * `is_current` is absent from every entry today but still breaks a tie when no
 * window matches. A feed published ahead of its start date is the last resort
 * (newest start wins), so the version gate keeps working if AT ever lists the
 * upcoming feed on its own.
 * @param versions - Version entries from `/versions`.
 * @param serviceDate - NZ service date as `YYYY-MM-DD`.
 * @returns The chosen `feed_version`, or null when no entry carries one.
 */
export function pickCurrentVersion(
  versions: GtfsVersionAttr[],
  serviceDate: string,
): string | null {
  return pickCurrentFeed(versions, serviceDate)?.feed_version ?? null;
}

/**
 * The feed entry {@link pickCurrentVersion} names, kept whole so a caller can
 * read its date window as well as its version. The ranking is described there.
 * @param versions - Version entries from `/versions`.
 * @param serviceDate - NZ service date as `YYYY-MM-DD`.
 * @returns The chosen entry, or null when none carries a version.
 */
function pickCurrentFeed(
  versions: GtfsVersionAttr[],
  serviceDate: string,
): (GtfsVersionAttr & { feed_version: string }) | null {
  const usable = versions.filter(
    (v): v is GtfsVersionAttr & { feed_version: string } =>
      typeof v.feed_version === "string" && v.feed_version.length > 0,
  );
  if (usable.length === 0) return null;

  const today = serviceDate.replace(/-/g, "");
  const covering = usable.find(
    (v) =>
      typeof v.feed_start_date === "string" &&
      typeof v.feed_end_date === "string" &&
      v.feed_start_date <= today &&
      today <= v.feed_end_date,
  );
  if (covering) return covering;

  const flagged = usable.find((v) => v.is_current === true);
  if (flagged) return flagged;

  return usable.reduce((best, v) =>
    (v.feed_start_date ?? "") > (best.feed_start_date ?? "") ? v : best,
  );
}

/**
 * Fetch the feed version AT is currently publishing.
 * @returns The version string, or null when the endpoint lists none.
 */
export async function fetchCurrentGtfsVersion(): Promise<string | null> {
  const page = await getJson<GtfsVersionAttr>("/versions");
  return pickCurrentVersion(
    page.data.map((d) => d.attributes),
    nzServiceDayString(new Date()),
  );
}

/** The span of service dates AT currently publishes a timetable for. */
export interface FeedWindow {
  /** First service date covered, as `YYYY-MM-DD`. */
  start: string;
  /** Last service date covered, as `YYYY-MM-DD`. */
  end: string;
  /** The feed publishing them. */
  version: string;
}

/**
 * Convert AT's compact `YYYYMMDD` to the dashed form the rest of the site uses.
 * @param compact - AT's date string, or whatever the field actually held.
 * @returns The dashed date, or null when the value is not eight digits.
 */
function dashedDate(compact: unknown): string | null {
  if (typeof compact !== "string" || !/^\d{8}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`;
}

/**
 * The date window of the feed covering a service date, from `/versions` entries.
 * @param versions - Version entries from `/versions`.
 * @param serviceDate - NZ service date as `YYYY-MM-DD`.
 * @returns The window, or null when no entry carries both bounds.
 */
export function feedWindowOf(versions: GtfsVersionAttr[], serviceDate: string): FeedWindow | null {
  const feed = pickCurrentFeed(versions, serviceDate);
  if (!feed) return null;
  const start = dashedDate(feed.feed_start_date);
  const end = dashedDate(feed.feed_end_date);
  // Half a window is worse than none: it would either call a day gone that AT
  // still publishes, or skip the check for one that it does not.
  return start !== null && end !== null ? { start, end, version: feed.feed_version } : null;
}

/**
 * Whether AT still publishes a timetable for a service date.
 * @param window - The live feed window, or null when it could not be read.
 * @param date - Service date as `YYYY-MM-DD`.
 * @returns True when the date is inside the window, or when there is no window
 *   to judge by - an unreadable window must not make a day look retired.
 */
export function insideFeedWindow(window: FeedWindow | null, date: string): boolean {
  return window === null || (window.start <= date && date <= window.end);
}

/**
 * The feed window AT is publishing right now, cached six hours - 28 calls a
 * week, against a value that changes when AT republishes.
 *
 * This is a separate cached path from {@link fetchCurrentGtfsVersion}, which is
 * uncached because the nightly GTFS sync wants the live answer. Here a page
 * render asks on every stop it draws, and the answer only moves when AT
 * republishes.
 *
 * Worth knowing for a site that keeps ten years of arrivals: AT publishes only
 * about four months of timetable and the start date rolls forward with each
 * republish, so days inside the archive fall out of the window over time. That
 * is why the copy is generated from the window rather than written down.
 * @returns The window, or null when `/versions` could not be read or carries no
 *   dates - both of which mean "do not claim a day is retired".
 */
export async function getFeedWindow(): Promise<FeedWindow | null> {
  const today = nzServiceDayString(new Date());
  try {
    return await unstable_cache(
      async () => {
        const page = await getJson<GtfsVersionAttr>("/versions");
        return feedWindowOf(
          page.data.map((d) => d.attributes),
          today,
        );
      },
      ["at-feed-window-v1", today],
      { revalidate: 21_600 },
    )();
  } catch {
    // Caught outside the cache, so a refused call is retried on the next render
    // rather than being held for six hours.
    return null;
  }
}
