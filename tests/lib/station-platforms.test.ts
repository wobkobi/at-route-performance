// tests/lib/station-platforms.test.ts
/// Unit tests for the per-platform breakdown gate in station-platforms.ts.
// The figures are real: every multi-platform case below is a station AT
// publishes, measured over the service day of 23 September 2026.
import {
  MIN_PLATFORM_EVENTS,
  PLATFORM_SPREAD_PCT,
  type PlatformStats,
  platformBreakdown,
  platformNoun,
  platformsDiffer,
} from "@/lib/station-platforms";
import { describe, expect, it } from "vitest";

/**
 * Build a platform for the fixtures.
 * @param label - AT's label for the platform.
 * @param events - Arrivals recorded there.
 * @param onTime - On-time share, or null when it has none.
 * @param avgAbs - Mean off-schedule magnitude in seconds.
 * @param routes - Route names that called there.
 * @returns The platform in the shape the gate takes.
 */
function platform(
  label: string,
  events: number,
  onTime: number | null,
  avgAbs: number,
  routes: string[] = ["1"],
): PlatformStats {
  return {
    stop_id: `stop-${label}`,
    label,
    events,
    avg_delay_sec: avgAbs,
    avg_abs_delay_sec: avgAbs,
    on_time_pct: onTime,
    routes,
    mode: "BUS",
  };
}

describe("platformNoun", () => {
  it("takes AT's own word when every platform shares one", () => {
    expect(platformNoun([{ label: "Bay 8" }, { label: "Bay 17" }])).toBe("bay");
    expect(platformNoun([{ label: "Pier 1" }, { label: "Pier 2" }])).toBe("pier");
  });

  it("falls back to platform for bare numbers or a mixed set", () => {
    expect(platformNoun([{ label: "1" }, { label: "3" }])).toBe("platform");
    expect(platformNoun([{ label: "Bay 8" }, { label: "Pier 1" }])).toBe("platform");
    expect(platformNoun([])).toBe("platform");
  });

  it("says stop for a bus interchange, matching the page's own eyebrow", () => {
    // AT's word for a bus pole, and the eyebrow above now counts them ("2 bus
    // stops"), so the heading can use it without claiming the whole place.
    expect(platformNoun([{ label: "Stop A" }, { label: "Stop C" }])).toBe("stop");
  });
});

describe("platformsDiffer", () => {
  it("is true only at or past the spread bound", () => {
    expect(platformsDiffer([{ on_time_pct: 91.5 }, { on_time_pct: 19.4 }])).toBe(true);
    expect(platformsDiffer([{ on_time_pct: 60 }, { on_time_pct: 50 }])).toBe(true);
    expect(platformsDiffer([{ on_time_pct: 60 }, { on_time_pct: 50.1 }])).toBe(false);
  });

  it("needs two measured shares, so unknowns do not stand in for a spread", () => {
    expect(platformsDiffer([{ on_time_pct: 91.5 }, { on_time_pct: null }])).toBe(false);
    expect(platformsDiffer([{ on_time_pct: 91.5 }])).toBe(false);
    expect(platformsDiffer([])).toBe(false);
  });

  it("agrees with the gate about why a station is listed", () => {
    // Manukau's bays differ; the sentence on the page says so. Two platforms that
    // agree are listed only because a route leaves from one of them, and there the
    // page must not claim they ran differently.
    const differing = [platform("Bay 15", 40, 58, 300), platform("Bay 12", 40, 84.8, 120)];
    const agreeing = [
      platform("Bay 15", 40, 58, 300, ["352"]),
      platform("Bay 12", 40, 60, 120, ["36"]),
    ];
    expect(platformBreakdown(differing)).toHaveLength(2);
    expect(platformsDiffer(differing)).toBe(true);
    expect(platformBreakdown(agreeing)).toHaveLength(2);
    expect(platformsDiffer(agreeing)).toBe(false);
  });
});

describe("platformBreakdown", () => {
  it("shows a station whose platforms disagree, worst off schedule first", () => {
    // Te Waihorotiu: Stop C ran 19% on time at four minutes early, Stop A 92%.
    const rows = platformBreakdown([
      platform("Stop A", 236, 92, 45, ["25B", "25L"]),
      platform("Stop C", 377, 19, 252, ["25B", "25L"]),
      platform("Stop D", 366, 75, 111, ["25B", "25L"]),
      platform("Stop B", 282, 51, 35, ["25B", "25L"]),
    ]);
    expect(rows.map((r) => r.label)).toEqual(["Stop C", "Stop D", "Stop A", "Stop B"]);
  });

  it("shows a bus station whose bays each serve one route", () => {
    // Manukau: 12 bays carried arrivals that day and 11 of them served exactly
    // one route, so both triggers fire - 66% against 85%, and every bay sole.
    const rows = platformBreakdown([
      platform("Bay 8", 239, 66, 18, ["33"]),
      platform("Bay 17", 79, 85, 126, ["313"]),
      platform("Bay 15", 54, 65, 105, ["366"]),
    ]);
    expect(rows.map((r) => [r.label, r.only_routes])).toEqual([
      ["Bay 17", ["313"]],
      ["Bay 15", ["366"]],
      ["Bay 8", ["33"]],
    ]);
  });

  it("can lose its reason to show when a thin platform drops out", () => {
    // Otahuhu Train Station read 96%, 89% and 78%, an 18-point spread - but the
    // 78% is nine arrivals, under the floor, and the two that remain agree to
    // within 7 points and share both their routes. The disagreement was the thin
    // platform, so there is nothing left to show, which is the floor and the
    // spread bound working together rather than against each other.
    const rows = platformBreakdown([
      platform("1", 155, 96, 108, ["STH", "EAST"]),
      platform("3", 152, 89, 62, ["STH", "EAST"]),
      platform("2", 9, 78, 63, ["STH", "EAST"]),
    ]);
    expect(rows).toEqual([]);
  });

  it("hides a station whose platforms agree and share every route", () => {
    const rows = platformBreakdown([
      platform("Stop A", 200, 71, 40, ["70", "72X"]),
      platform("Stop B", 180, 74, 38, ["70", "72X"]),
      platform("Stop C", 150, 69, 44, ["70", "72X"]),
    ]);
    expect(rows).toEqual([]);
  });

  it("shows a station where the platforms agree but a route leaves from one only", () => {
    // The other reader: whoever wants route 33 needs the bay, not the average.
    const rows = platformBreakdown([
      platform("Bay 1", 200, 71, 40, ["70", "33"]),
      platform("Bay 2", 180, 74, 38, ["70"]),
    ]);
    expect(rows.map((r) => [r.label, r.only_routes])).toEqual([
      ["Bay 1", ["33"]],
      ["Bay 2", []],
    ]);
  });

  it("counts a route as leaving from one platform only when no other has it", () => {
    const rows = platformBreakdown([
      platform("Bay 1", 200, 40, 40, ["70", "33", "58"]),
      platform("Bay 2", 180, 80, 38, ["70", "58"]),
    ]);
    expect(rows.find((r) => r.label === "Bay 1")?.only_routes).toEqual(["33"]);
    expect(rows.find((r) => r.label === "Bay 2")?.only_routes).toEqual([]);
  });

  it("ignores a platform under the arrivals floor when deciding whether to show", () => {
    // Manukau had a bay with four arrivals reading 75% on nothing. On its own it
    // would make every station look like its platforms disagreed.
    const rows = platformBreakdown([
      platform("Bay 8", 239, 66, 18, ["33"]),
      platform("Bay 11", MIN_PLATFORM_EVENTS - 1, 100, 0, ["33"]),
    ]);
    expect(rows).toEqual([]);
  });

  it("hides a stop with a single platform", () => {
    expect(platformBreakdown([platform("1", 500, 40, 300)])).toEqual([]);
    expect(platformBreakdown([])).toEqual([]);
  });

  it("needs two measurable shares before a spread can be read", () => {
    // One platform with no on-time share cannot make a spread with another.
    const rows = platformBreakdown([
      platform("Stop A", 100, null, 40, ["70"]),
      platform("Stop B", 100, 20, 38, ["70"]),
    ]);
    expect(rows).toEqual([]);
  });

  it("sorts a platform with no average last rather than as on time", () => {
    const rows = platformBreakdown([
      platform("Bay 1", 100, 30, 200, ["70", "33"]),
      { ...platform("Bay 2", 100, 90, 0, ["70"]), avg_abs_delay_sec: null },
      platform("Bay 3", 100, 60, 50, ["70"]),
    ]);
    expect(rows.map((r) => r.label)).toEqual(["Bay 1", "Bay 3", "Bay 2"]);
  });

  it("gives the same rows whichever order the platforms arrive in", () => {
    const input = [
      platform("Bay 1", 100, 30, 50, ["70", "33"]),
      platform("Bay 2", 100, 90, 50, ["70"]),
      platform("Bay 3", 100, 60, 50, ["70"]),
    ];
    expect(platformBreakdown([...input].reverse())).toEqual(platformBreakdown(input));
  });

  it("treats the spread bound as inclusive", () => {
    const at = platformBreakdown([
      platform("Stop A", 100, 70, 40, ["70"]),
      platform("Stop B", 100, 70 + PLATFORM_SPREAD_PCT, 38, ["70"]),
    ]);
    expect(at).toHaveLength(2);
    const under = platformBreakdown([
      platform("Stop A", 100, 70, 40, ["70"]),
      platform("Stop B", 100, 70 + PLATFORM_SPREAD_PCT - 0.1, 38, ["70"]),
    ]);
    expect(under).toEqual([]);
  });
});
