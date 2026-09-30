// tests/lib/shame-page.test.ts
// Unit tests for the shame boards' shared param parsing: what each board filters
// on, what it says it filtered on, and what its links keep.
import {
  buildShameHref,
  crownedTop,
  hoursNoun,
  parseShameParams,
  SHAME_PARAMS,
  shameDayListHref,
  shameHourHref,
  shameHoursLabel,
  subtitleWithDirection,
  WHOLE_DAY,
} from "@/lib/shame-page";
import { describe, expect, it } from "vitest";

describe("parseShameParams", () => {
  it("defaults to every mode, no school services and both directions", () => {
    const p = parseShameParams({});
    expect(p.filter).toEqual({ mode: null, schools: "exclude", direction: null });
    expect(p.view).toBe("day");
    expect(p.subtitle).toBe("Buses, trains & ferries");
    expect(p.preserved).toEqual({});
  });

  it("reads a direction and keeps it for the other controls' links", () => {
    const p = parseShameParams({ dir: "late", mode: "TRAIN", school: "1" });
    expect(p.direction).toBe("late");
    expect(p.preserved).toEqual({ mode: "TRAIN", school: "1", dir: "late" });
  });

  it("reads an unknown direction as both, so a bad link is not an empty board", () => {
    expect(parseShameParams({ dir: "sideways" }).direction).toBeNull();
    expect(parseShameParams({ dir: "" }).direction).toBeNull();
  });

  it("reads the hours on the day board only", () => {
    expect(parseShameParams({ hours: "7-9" }).hours).toEqual({ from: 7, to: 9 });
    expect(parseShameParams({ hours: "7-9", window: "week" }).hours).toBeNull();
    expect(parseShameParams({ hours: "junk" }).hours).toBeNull();
  });

  it("reads all as the whole service day", () => {
    expect(parseShameParams({ hours: "all" }).hours).toEqual(WHOLE_DAY);
    expect(parseShameParams({ hours: "all", window: "month" }).hours).toBeNull();
  });

  it("names school buses alone and keeps the choice on the links", () => {
    const p = parseShameParams({ school: "only" });
    expect(p.filter.schools).toBe("only");
    expect(p.preserved).toEqual({ school: "only" });
    expect(p.subtitle).toBe("School buses");
  });

  it("leaves the direction out of the subtitle, which the boards without it share", () => {
    expect(parseShameParams({ dir: "early", mode: "FERRY" }).subtitle).toBe("Ferries");
  });
});

describe("subtitleWithDirection", () => {
  it("names the direction the board was asked for", () => {
    expect(subtitleWithDirection("Trains", "late")).toBe("Trains · Late only");
    expect(subtitleWithDirection("Trains", "early")).toBe("Trains · Early only");
  });

  it("leaves the subtitle alone when both directions are shown", () => {
    expect(subtitleWithDirection("Trains", null)).toBe("Trains");
  });
});

describe("SHAME_PARAMS", () => {
  // `/shame` lands on the trips board, which has no direction to narrow, so
  // forwarding `dir` would put a param on a page that cannot act on it.
  it("does not forward the direction across the section redirect", () => {
    expect(SHAME_PARAMS).not.toContain("dir");
  });
});

describe("buildShameHref", () => {
  // The tab links are the only hrefs this builds, and the tab a reader is on is
  // rendered as a span - so every href it produces points at a board that reads
  // no direction.
  it("keeps mode and school but not the direction", () => {
    expect(
      buildShameHref(
        "/shame/trip",
        { day: "2026-09-20" },
        { mode: "BUS", schools: "include", direction: "late" },
      ),
    ).toBe("/shame/trip?day=2026-09-20&mode=BUS&school=1");
  });
});

describe("shameHourHref", () => {
  const filter = { mode: "BUS" as const, schools: "exclude" as const, direction: null };

  it("opens the same board on that hour, keeping the day and filters", () => {
    expect(shameHourHref("/shame/trip", "2026-09-20", 8, filter)).toBe(
      "/shame/trip?day=2026-09-20&hours=8-9&mode=BUS",
    );
  });

  it("wraps the last hour of the clock to midnight", () => {
    expect(shameHourHref("/shame/trip", undefined, 23, filter)).toBe(
      "/shame/trip?hours=23-0&mode=BUS",
    );
  });

  it("carries the stop board's direction when given it", () => {
    expect(shameHourHref("/shame/stop", undefined, 8, filter, { dir: "late" })).toBe(
      "/shame/stop?dir=late&hours=8-9&mode=BUS",
    );
  });
});

describe("shameDayListHref", () => {
  const filter = { mode: "BUS" as const, schools: "exclude" as const, direction: null };

  it("opens the day board ranked over the whole day", () => {
    expect(shameDayListHref("/shame/route", "2026-09-24", filter)).toBe(
      "/shame/route?day=2026-09-24&hours=all&mode=BUS",
    );
  });

  it("round-trips through the parser", () => {
    const href = shameDayListHref("/shame/stop", undefined, filter, { dir: "early" });
    const sp = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseShameParams(sp).hours).toEqual(WHOLE_DAY);
    expect(sp.dir).toBe("early");
  });
});

describe("hoursNoun", () => {
  it("names a single hour, wrapping included, as this hour", () => {
    expect(hoursNoun({ from: 8, to: 9 })).toBe("in this hour");
    expect(hoursNoun({ from: 23, to: 0 })).toBe("in this hour");
    expect(hoursNoun({ from: 7, to: 9 })).toBe("in these hours");
  });

  it("names the whole day as that day", () => {
    expect(hoursNoun(WHOLE_DAY)).toBe("that day");
  });
});

describe("shameHoursLabel", () => {
  it("names an hour, a stretch and the whole day", () => {
    expect(shameHoursLabel({ from: 8, to: 9 })).toBe("8am hour");
    expect(shameHoursLabel(WHOLE_DAY)).toBe("whole day");
  });
});

describe("crownedTop", () => {
  it("crowns the first row when it clears the late bound", () => {
    const rows = [
      { id: "a", avg_abs_delay_sec: 600 },
      { id: "b", avg_abs_delay_sec: 900 },
    ];
    expect(crownedTop(rows)).toEqual({ row: rows[0], ranked: true });
  });

  it("crowns nothing when the top row is on time", () => {
    expect(crownedTop([{ avg_abs_delay_sec: 30 }])).toEqual({ row: null, ranked: true });
  });

  it("reports an empty board as unranked", () => {
    expect(crownedTop([])).toEqual({ row: null, ranked: false });
  });
});
