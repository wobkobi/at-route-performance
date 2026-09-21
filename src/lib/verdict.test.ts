import { VERDICT_BANDS, dayVerdict, verdictIndex } from "@/lib/verdict";
import { describe, expect, it } from "vitest";

describe("dayVerdict", () => {
  it("lands each floor in its own band and the value just under it in the next", () => {
    for (let i = 0; i < VERDICT_BANDS.length - 1; i++) {
      const band = VERDICT_BANDS[i]!;
      expect(dayVerdict(band.floor)).toBe(band);
      expect(dayVerdict(band.floor - 0.1)).toBe(VERDICT_BANDS[i + 1]);
    }
  });

  it("covers both ends of the range", () => {
    expect(dayVerdict(100)?.label).toBe("Actually fine");
    expect(dayVerdict(0)?.label).toBe("Shit");
  });

  it("gives no verdict without a share", () => {
    expect(dayVerdict(null)).toBeNull();
    expect(dayVerdict(Number.NaN)).toBeNull();
  });

  it("puts every full day on record mid-scale, not all in one band", () => {
    // Event-weighted network on-time share for 10-17 Sep 2026. If a change to
    // the data shape collapses these into one band, the scale stops moving.
    const observed = [62.4, 67.3, 65.6, 60.8, 63.0, 63.0, 63.6, 62.4];
    const labels = observed.map((pct) => dayVerdict(pct)?.label);
    for (const label of labels) expect(["Rough", "Meh"]).toContain(label);
    expect(new Set(labels).size).toBe(2);
  });
});

describe("VERDICT_BANDS", () => {
  it("lists floors strictly descending, ending at 0", () => {
    for (let i = 1; i < VERDICT_BANDS.length; i++) {
      expect(VERDICT_BANDS[i]!.floor).toBeLessThan(VERDICT_BANDS[i - 1]!.floor);
    }
    expect(VERDICT_BANDS.at(-1)?.floor).toBe(0);
  });
});

describe("verdictIndex", () => {
  it("counts rungs from the worst end", () => {
    expect(verdictIndex(dayVerdict(10))).toBe(0);
    expect(verdictIndex(dayVerdict(63))).toBe(1);
    expect(verdictIndex(dayVerdict(95))).toBe(VERDICT_BANDS.length - 1);
  });

  it("gives -1 for no verdict", () => {
    expect(verdictIndex(null)).toBe(-1);
  });
});
