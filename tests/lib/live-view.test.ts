// tests/lib/live-view.test.ts
// Unit tests for viewIncludesToday, the gate on the footer's live refresh.
import { viewIncludesToday } from "@/lib/live-view";
import { describe, expect, it } from "vitest";

const TODAY = "2026-09-18";

/**
 * Ask the gate about a URL's params against {@link TODAY}.
 * @param day - The `?day=` value, or null.
 * @param period - The `?period=` value, or null.
 * @returns The gate's answer.
 */
function live(day: string | null, period: string | null = null): boolean {
  return viewIncludesToday({ day, period }, TODAY);
}

describe("viewIncludesToday", () => {
  it("treats a page with no window params as live", () => {
    expect(live(null)).toBe(true);
  });

  it("is live on the day view only for the live day itself", () => {
    expect(live(TODAY)).toBe(true);
    expect(live("2026-09-17")).toBe(false);
    expect(live("2026-09-11")).toBe(false);
  });

  it("is live on the month view only for the month holding the live day", () => {
    expect(live(null, "2026-09")).toBe(true);
    expect(live(null, "2026-08")).toBe(false);
  });

  it("is live on the week view only for the week holding the live day", () => {
    expect(live(null, "2026-09-14")).toBe(true);
    expect(live(null, TODAY)).toBe(true);
    // The last week the live day is still inside: it started six days ago.
    expect(live(null, "2026-09-12")).toBe(true);
    // Ended the day before the live day.
    expect(live(null, "2026-09-11")).toBe(false);
    expect(live(null, "2026-09-19")).toBe(false);
  });

  it("counts a value in an unrecognised shape as live rather than frozen", () => {
    expect(live("yesterday")).toBe(true);
    expect(live(null, "last-week")).toBe(true);
  });
});
