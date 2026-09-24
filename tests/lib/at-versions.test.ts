// tests/lib/at-versions.test.ts
// Unit tests for the GTFS feed-version selector in at-versions.ts.

import {
  feedWindowOf,
  type GtfsVersionAttr,
  insideFeedWindow,
  pickCurrentVersion,
} from "@/lib/at-versions";
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

describe("feedWindowOf", () => {
  it("dashes AT's compact dates and carries the version", () => {
    // The live payload on 24 Sep 2026, whose start had rolled forward a week
    // from the 20260907 measured eight days earlier.
    const live = [v("VDV_Merge_118_5_H_7_331", "20260917", "20261231")];
    expect(feedWindowOf(live, "2026-09-24")).toEqual({
      start: "2026-09-17",
      end: "2026-12-31",
      version: "VDV_Merge_118_5_H_7_331",
    });
  });

  it("gives nothing when a bound is missing or malformed", () => {
    // Half a window would either retire a day AT still publishes or skip the
    // check for one it does not, so neither half is used on its own.
    expect(feedWindowOf([v("x", "20260917")], "2026-09-24")).toBeNull();
    expect(feedWindowOf([v("x", undefined, "20261231")], "2026-09-24")).toBeNull();
    expect(feedWindowOf([v("x", "2026-09-17", "20261231")], "2026-09-24")).toBeNull();
    expect(feedWindowOf([], "2026-09-24")).toBeNull();
  });
});

describe("insideFeedWindow", () => {
  const window = { start: "2026-09-17", end: "2026-12-31", version: "x" };

  it("includes both bounds", () => {
    expect(insideFeedWindow(window, "2026-09-17")).toBe(true);
    expect(insideFeedWindow(window, "2026-12-31")).toBe(true);
    expect(insideFeedWindow(window, "2026-09-16")).toBe(false);
    expect(insideFeedWindow(window, "2027-01-01")).toBe(false);
  });

  it("puts a day the site can still reach outside the window", () => {
    // The archive floor is 2026-09-11 and AT's feed starts 2026-09-17, so six
    // service days are readable here and retired at AT. Measured against the
    // live API: 16 Sep answers 404, 17 Sep answers 200. This state is live, not
    // theoretical, and it grows as the feed start rolls forward.
    expect(insideFeedWindow(window, "2026-09-11")).toBe(false);
  });

  it("calls a day publishable when the window could not be read", () => {
    // A failed /versions read must not make every day look retired.
    expect(insideFeedWindow(null, "1999-01-01")).toBe(true);
  });
});
