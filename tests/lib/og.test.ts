// tests/lib/og.test.ts
// Unit tests for the shared-link card definitions.
import {
  cardCacheControl,
  cardFilterLabel,
  cardWhenSuffix,
  homeCardPath,
  homeCardTitle,
  parseCardQuery,
  parseHomeCard,
  parseHomeCardQuery,
  parseRouteCard,
  parseStopCard,
  parseTripCard,
  subjectCardPath,
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

/**
 * Parse a card path back through the handler's parser.
 * @param path - A path from a card builder.
 * @returns The parsed card.
 */
function reparse(path: string): ReturnType<typeof parseCardQuery> {
  return parseCardQuery(new URL(path, "https://example.test").searchParams);
}

describe("route cards", () => {
  it("strips the feed version and keeps a valid day", () => {
    const card = parseRouteCard("501-217", { day: "2026-09-20" });
    expect(subjectCardPath(card)).toBe("/api/og?card=route&id=501&day=2026-09-20");
  });

  it("reads any window but the day as the week, dropping the day", () => {
    const card = parseRouteCard("20", { window: "month", day: "2026-09-20", period: "2026-09" });
    // A month key is not a week's Monday, so the week falls back to the last 7 days.
    expect(card).toMatchObject({ window: "week", day: null, period: null });
    expect(cardWhenSuffix(card)).toBe(", last 7 days");
    expect(cardWhenSuffix(parseRouteCard("20", { window: "week", period: "2026-09-14" }))).toBe(
      ", week of Mon 14 Sep",
    );
  });

  it("round-trips through the handler's parse", () => {
    const card = parseRouteCard("NX1", { window: "week", period: "2026-09-14" });
    expect(reparse(subjectCardPath(card))).toEqual(card);
  });
});

describe("trip cards", () => {
  it("keeps the run's service day, not its instant", () => {
    // 07:45 NZST on the 20th.
    const card = parseTripCard("152-203", "1152-20310-27900-2-a1b2", "2026-09-19T19:45:00Z");
    expect(card.day).toBe("2026-09-20");
    expect(reparse(subjectCardPath(card))).toEqual(card);
  });

  it("leaves the day to the handler when the instant is bad", () => {
    expect(parseTripCard("152", "t1", "not-a-date").day).toBeNull();
    expect(cardWhenSuffix(parseTripCard("152", "t1", undefined))).toBe("");
  });
});

describe("stop cards", () => {
  it("round-trips an id with characters that need encoding", () => {
    const card = parseStopCard("station:133-a1", { day: "2026-09-20" });
    expect(reparse(subjectCardPath(card))).toEqual(card);
    expect(cardWhenSuffix(card)).toBe(", Sun 20 Sep");
  });
});

describe("parseCardQuery", () => {
  it("falls back to the home card without an id", () => {
    expect(reparse("/api/og?card=route").kind).toBe("home");
    expect(reparse("/api/og?card=trip&id=20").kind).toBe("home");
    expect(reparse(`/api/og?card=stop&id=${"x".repeat(200)}`).kind).toBe("home");
  });
});
