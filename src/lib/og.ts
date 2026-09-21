// src/lib/og.ts
// Shared-link cards: the one definition of what a card is for. A page's
// generateMetadata turns its own query into the card URL here, and /api/og
// parses that URL back here, so the two cannot disagree about which day, window
// or filter a card describes. Pure and unit-tested; the rendering and the data
// reads live in the route handler.
import { resolveRequestedDay, resolveRequestedMonth } from "@/lib/page-nav";
import { parseRangeWindow, type RangeWindow } from "@/lib/range-page";
import { serviceDayLabel } from "@/lib/time";
import { buildHref } from "@/lib/utils";

/** Card canvas: the 1.91:1 Slack, Discord, X and LinkedIn all accept. */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** The modes a card can be filtered to. */
const MODES = ["BUS", "TRAIN", "FERRY"] as const;
type CardMode = (typeof MODES)[number];

/** Plural nouns for the eyebrow's filter. */
const MODE_NOUNS: Record<CardMode, string> = { BUS: "Buses", TRAIN: "Trains", FERRY: "Ferries" };

/** Month names for a `YYYY-MM` period. */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** What the home page's card describes, validated. */
export interface HomeCard {
  window: RangeWindow;
  /** The requested day (`YYYY-MM-DD`) on the day window, or null for today. */
  day: string | null;
  /** The requested week (its Monday) or month (`YYYY-MM`), or null for the default. */
  period: string | null;
  mode: CardMode | null;
  includeSchool: boolean;
}

/** The raw query a home card is built from: the page's own search params. */
export interface HomeCardParams {
  window?: string;
  day?: string;
  period?: string;
  mode?: string;
  school?: string;
}

/**
 * Validate the home page's query into the state its card describes. Invalid
 * values fall back exactly as the page's own parsing does, so a card never
 * names a day or filter the page would not show.
 * @param sp - The raw params (from the page, or from the card URL).
 * @returns The card state.
 */
export function parseHomeCard(sp: HomeCardParams): HomeCard {
  const window = parseRangeWindow(sp.window);
  const mode = MODES.find((m) => m === sp.mode) ?? null;
  let period: string | null = null;
  if (window === "week") period = resolveRequestedDay(sp.period);
  if (window === "month") period = resolveRequestedMonth(sp.period);
  return {
    window,
    day: window === "day" ? resolveRequestedDay(sp.day) : null,
    period,
    mode,
    includeSchool: sp.school === "1",
  };
}

/**
 * The card URL for a home page view, relative so Next resolves it against the
 * deployment's own origin. Carries only validated state, so two spellings of
 * one view share a cached card.
 * @param sp - The page's raw query.
 * @returns The `/api/og` path with its query.
 */
export function homeCardPath(sp: HomeCardParams): string {
  const c = parseHomeCard(sp);
  return buildHref("/api/og", {
    card: "home",
    window: c.window === "day" ? undefined : c.window,
    day: c.day ?? undefined,
    period: c.period ?? undefined,
    mode: c.mode ?? undefined,
    school: c.includeSchool ? "1" : undefined,
  });
}

/**
 * Parse a card URL's query back into its state.
 * @param query - The `/api/og` request's search params.
 * @returns The card state.
 */
export function parseHomeCardQuery(query: URLSearchParams): HomeCard {
  return parseHomeCard({
    window: query.get("window") ?? undefined,
    day: query.get("day") ?? undefined,
    period: query.get("period") ?? undefined,
    mode: query.get("mode") ?? undefined,
    school: query.get("school") ?? undefined,
  });
}

/**
 * The filter part of an eyebrow ("Trains", "Buses incl. school"), or null when
 * the card covers the whole network.
 * @param mode - The mode filter.
 * @param includeSchool - Whether school services are counted.
 * @returns The label, or null.
 */
export function cardFilterLabel(mode: CardMode | null, includeSchool: boolean): string | null {
  const noun = mode ? MODE_NOUNS[mode] : null;
  if (!includeSchool) return noun;
  return noun ? `${noun} incl. school` : "Incl. school services";
}

/**
 * A `YYYY-MM` month as "September 2026".
 * @param ym - The month.
 * @returns The label.
 */
export function monthLabel(ym: string): string {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ""} ${ym.slice(0, 4)}`;
}

/**
 * The page title a home card's link unfurls with, from the query alone: no
 * data read, so metadata never waits on the database. The card image carries
 * the figures.
 * @param c - The card state.
 * @returns The title.
 */
export function homeCardTitle(c: HomeCard): string {
  const filter = cardFilterLabel(c.mode, c.includeSchool);
  let when: string;
  if (c.window === "day") when = c.day ? `on ${serviceDayLabel(c.day)}` : "today";
  else if (c.window === "week")
    when = c.period ? `the week of ${serviceDayLabel(c.period)}` : "this week";
  else when = c.period ? `in ${monthLabel(c.period)}` : "this month";
  return `How bad was it ${when}?${filter ? ` (${filter})` : ""}`;
}

/**
 * Cache-Control for a card. A finished day or period never changes, so its card
 * is kept for a week at the CDN; a live one refreshes with the ingest cycle.
 * @param complete - Whether everything the card describes is in the past.
 * @returns The header value.
 */
export function cardCacheControl(complete: boolean): string {
  return complete
    ? "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400"
    : "public, max-age=300, s-maxage=300, stale-while-revalidate=600";
}
