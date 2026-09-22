// tests/lib/day-url.test.ts
// The `?day` clamp: a day outside the archive redirects onto the nearest real
// one, and a clamp onto today drops the param rather than costing a second hop.
import { DATA_START_DAY } from "@/lib/data-start";
import { clampDayParam } from "@/lib/day-url";
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
