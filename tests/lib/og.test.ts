// tests/lib/og.test.ts
// Unit tests for the shared-link card definitions.
import {
  cardCacheControl,
  cardFilterLabel,
  homeCardPath,
  homeCardTitle,
  parseHomeCard,
  parseHomeCardQuery,
} from "@/lib/og";
import { describe, expect, it } from "vitest";

describe("homeCardPath", () => {
  it("keeps a past day and the filters", () => {
    expect(homeCardPath({ day: "2026-09-20", mode: "TRAIN", school: "1" })).toBe(
      "/api/og?card=home&day=2026-09-20&mode=TRAIN&school=1",
    );
  });

  it("drops what the page would ignore, so one view has one card", () => {
    // A day on a week window, an impossible date, an unknown mode.
    expect(homeCardPath({ window: "week", day: "2026-09-20" })).toBe(
      "/api/og?card=home&window=week",
    );
    expect(homeCardPath({ day: "2026-02-31" })).toBe("/api/og?card=home");
    expect(homeCardPath({ mode: "TRAM" })).toBe("/api/og?card=home");
  });

  it("carries a month's period", () => {
    expect(homeCardPath({ window: "month", period: "2026-09" })).toBe(
      "/api/og?card=home&window=month&period=2026-09",
    );
  });

  it("round-trips through the handler's parse", () => {
    const sp = { window: "week", period: "2026-09-14", mode: "BUS" };
    const url = new URL(homeCardPath(sp), "https://example.test");
    expect(parseHomeCardQuery(url.searchParams)).toEqual(parseHomeCard(sp));
  });
});

describe("homeCardTitle", () => {
  it("names the day, week or month the link is for", () => {
    expect(homeCardTitle(parseHomeCard({}))).toBe("How bad was it today?");
    expect(homeCardTitle(parseHomeCard({ day: "2026-09-20" }))).toBe(
      "How bad was it on Sun 20 Sep?",
    );
    expect(homeCardTitle(parseHomeCard({ window: "week", period: "2026-09-14" }))).toBe(
      "How bad was it the week of Mon 14 Sep?",
    );
    expect(homeCardTitle(parseHomeCard({ window: "month", period: "2026-09" }))).toBe(
      "How bad was it in September 2026?",
    );
  });

  it("names the filter", () => {
    expect(homeCardTitle(parseHomeCard({ window: "week", mode: "TRAIN" }))).toBe(
      "How bad was it this week? (Trains)",
    );
  });
});

describe("cardFilterLabel", () => {
  it("is null for the whole network", () => {
    expect(cardFilterLabel(null, false)).toBeNull();
  });

  it("says when school services are in", () => {
    expect(cardFilterLabel("BUS", true)).toBe("Buses incl. school");
    expect(cardFilterLabel(null, true)).toBe("Incl. school services");
  });
});

describe("cardCacheControl", () => {
  it("keeps a finished card far longer than a live one", () => {
    expect(cardCacheControl(true)).toContain("s-maxage=604800");
    expect(cardCacheControl(false)).toContain("s-maxage=300");
  });
});
