// tests/lib/restamp.test.ts
// Unit tests for the summary relabel the one-off service-day restamp performs.
import { restampedSummaryDate } from "@/lib/restamp";
import { describe, expect, it } from "vitest";

describe("restampedSummaryDate", () => {
  it("relabels a 5am summary stamp onto the 4am instant of the same date", () => {
    // 2026-09-11T17:00Z is 05:00 on 12 September NZST, the stored start of
    // service day 2026-09-12; its 4am instant is 2026-09-11T16:00Z.
    expect(restampedSummaryDate(new Date("2026-09-11T17:00:00Z"), 5, 4).toISOString()).toBe(
      "2026-09-11T16:00:00.000Z",
    );
  });

  it("inverts exactly, so a rollback restores the stamp it started from", () => {
    const original = new Date("2026-09-11T17:00:00Z");
    const moved = restampedSummaryDate(original, 5, 4);
    expect(restampedSummaryDate(moved, 4, 5).toISOString()).toBe(original.toISOString());
  });

  it("keeps a stamp on its own date across the NZDT start", () => {
    // 27 Sep 2026 skips 02:00-03:00, so both boundaries sit after the switch:
    // 05:00 NZDT is 2026-09-26T16:00Z and 04:00 NZDT is 2026-09-26T15:00Z.
    expect(restampedSummaryDate(new Date("2026-09-26T16:00:00Z"), 5, 4).toISOString()).toBe(
      "2026-09-26T15:00:00.000Z",
    );
  });
});
