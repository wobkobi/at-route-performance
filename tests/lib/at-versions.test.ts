// tests/lib/at-versions.test.ts
// Unit tests for the GTFS feed-version selector in at-versions.ts.

import { pickCurrentVersion, type GtfsVersionAttr } from "@/lib/at-versions";
import { describe, expect, it } from "vitest";

/**
 * Build a version entry.
 * @param feed_version - The feed's version string.
 * @param feed_start_date - First covered service date, `YYYYMMDD`.
 * @param feed_end_date - Last covered service date, `YYYYMMDD`.
 * @param is_current - Optional explicit current flag.
 * @returns A version entry shaped like AT's `/versions` attributes.
 */
function v(
  feed_version: string,
  feed_start_date?: string,
  feed_end_date?: string,
  is_current?: boolean,
): GtfsVersionAttr {
  return { feed_version, feed_start_date, feed_end_date, is_current };
}

describe("pickCurrentVersion", () => {
  it("reads feed_version, the field AT actually sends", () => {
    // The live payload carries feed_version/feed_start_date/feed_end_date and no
    // `version` key at all, so reading `version` yielded undefined.
    const live = [v("VDV_EOD_118_2_F_315.0858", "20260726", "20261122")];
    expect(pickCurrentVersion(live, "2026-08-07")).toBe("VDV_EOD_118_2_F_315.0858");
  });

  it("picks the feed whose date window covers the service day", () => {
    const list = [v("pre-crl", "20260726", "20260912"), v("crl", "20260913", "20270301")];
    expect(pickCurrentVersion(list, "2026-09-12")).toBe("pre-crl");
    expect(pickCurrentVersion(list, "2026-09-13")).toBe("crl");
  });

  it("prefers the covering window over an is_current flag on another entry", () => {
    const list = [v("pre-crl", "20260726", "20260912", true), v("crl", "20260913", "20270301")];
    expect(pickCurrentVersion(list, "2026-09-20")).toBe("crl");
  });

  it("falls back to is_current when no window covers the day", () => {
    const list = [v("old", "20250101", "20250201"), v("flagged", "20250601", "20250701", true)];
    expect(pickCurrentVersion(list, "2026-08-07")).toBe("flagged");
  });

  it("falls back to the newest start date when nothing else identifies a feed", () => {
    const list = [v("old", "20250101", "20250201"), v("newer", "20250601", "20250701")];
    expect(pickCurrentVersion(list, "2026-08-07")).toBe("newer");
  });

  it("ignores entries with no usable version and returns null when none remain", () => {
    expect(pickCurrentVersion([], "2026-08-07")).toBeNull();
    expect(pickCurrentVersion([{ feed_version: null }, { feed_version: "" }], "2026-08-07")).toBe(
      null,
    );
    expect(pickCurrentVersion([{ feed_version: null }, v("real")], "2026-08-07")).toBe("real");
  });
});
