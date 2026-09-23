// tests/lib/day-url.test.ts
// The `?day` clamp: a day outside the archive redirects onto the nearest real
// one, and a clamp onto today drops the param rather than costing a second hop.
// Plus the link side of the same rule, which keeps a board row off the redirect.
import { DATA_START_DAY } from "@/lib/data-start";
import { clampDayParam, dayLinkParam } from "@/lib/day-url";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  /**
   * Stand-in for Next's redirect, which throws to unwind the render.
   * @param href - Where the page would be sent.
   */
  redirect: (href: string): never => {
    throw new Error(`REDIRECT ${href}`);
  },
}));

const TODAY = "2026-09-16";

describe("clampDayParam", () => {
  it("redirects a day before the archive onto the first day, keeping other params", () => {
    const sp: { day?: string; mode?: string } = { day: "2026-09-01", mode: "BUS" };
    expect(() => {
      clampDayParam("/shame/stop", sp, TODAY);
    }).toThrow(`REDIRECT /shame/stop?mode=BUS&day=${DATA_START_DAY}`);
  });

  it("drops the param entirely when the clamp lands on today", () => {
    expect(() => {
      clampDayParam("/shame", { day: "2027-01-01" }, TODAY);
    }).toThrow("REDIRECT /shame");
  });

  it("leaves a day inside the archive, an absent day and an unreal date alone", () => {
    expect(() => {
      clampDayParam("/shame", { day: "2026-09-12" }, TODAY);
    }).not.toThrow();
    expect(() => {
      clampDayParam("/shame", {}, TODAY);
    }).not.toThrow();
    expect(() => {
      clampDayParam("/shame", { day: "2026-02-31" }, TODAY);
    }).not.toThrow();
  });
});

describe("dayLinkParam", () => {
  it("leaves today's day out, so a link to it skips the redirect", () => {
    expect(dayLinkParam(TODAY, TODAY)).toBeUndefined();
  });

  it("keeps any other day", () => {
    expect(dayLinkParam("2026-09-12", TODAY)).toBe("2026-09-12");
  });

  it("treats a missing day as today's view", () => {
    expect(dayLinkParam(null, TODAY)).toBeUndefined();
    expect(dayLinkParam(undefined, TODAY)).toBeUndefined();
  });
});
