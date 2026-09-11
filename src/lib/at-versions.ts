// src/lib/at-versions.ts
/**
 * @description Resolves which GTFS feed version AT is currently publishing, from
 * the GTFS v3 /versions endpoint. AT names the field `feed_version` (not
 * `version`) and ships no `is_current` flag, so the live feed is identified by
 * the `feed_start_date`/`feed_end_date` window that covers the service day.
 */
import { getJson } from "@/lib/at-static";
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
  if (covering) return covering.feed_version;

  const flagged = usable.find((v) => v.is_current === true);
  if (flagged) return flagged.feed_version;

  return usable.reduce((best, v) =>
    (v.feed_start_date ?? "") > (best.feed_start_date ?? "") ? v : best,
  ).feed_version;
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
