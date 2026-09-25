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

/**
 * Count the bare `new Date()` calls one call makes, so a helper that should not
 * have needed the clock can be shown not to have read it. Dates built from a
 * value are deterministic and are not counted.
 * @param run - The call to measure.
 * @returns How many times the clock was read.
 */
function clockReads(run: () => void): number {
  const real = globalThis.Date;
  let reads = 0;
  globalThis.Date = new Proxy(real, {
    /**
     * Count a bare construction, then build the Date the real way.
     * @param target - The real Date constructor.
     * @param args - The construction arguments; none of them means the clock.
     * @returns The Date.
     */
    construct(target: DateConstructor, args: unknown[]): object {
      if (args.length === 0) reads += 1;
      return Reflect.construct(target, args) as object;
    },
  });
  try {
    run();
  } finally {
    globalThis.Date = real;
  }
  return reads;
}

describe("the clock these helpers read", () => {
  // Under Cache Components a clock read with nothing asking for it abandons the
  // page's static shell, so each helper must reach it only on the branch that
  // needs it - which a default parameter value cannot do, since it is evaluated
  // before the body runs.
  it("goes unread when no day was asked for", () => {
    expect(
      clockReads(() => {
        clampDayParam("/shame", {});
      }),
    ).toBe(0);
    expect(clockReads(() => dayLinkParam(null))).toBe(0);
  });

  it("is read once when a day has to be placed against today", () => {
    expect(
      clockReads(() => {
        clampDayParam("/shame", { day: "2026-09-12" });
      }),
    ).toBe(1);
    expect(clockReads(() => dayLinkParam("2026-09-12"))).toBe(1);
  });
});
