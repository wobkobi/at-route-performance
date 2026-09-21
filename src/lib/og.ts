// src/lib/og.ts
// Shared-link cards: the one definition of what a card is for. A page's
// generateMetadata turns its own query into the card URL here, and /api/og
// parses that URL back here, so the two cannot disagree about which day, window
// or filter a card describes. Pure and unit-tested; the rendering and the data
// reads live in the route handler.
import { resolveRequestedDay, resolveRequestedMonth } from "@/lib/page-nav";
import { parseRangeWindow, type RangeWindow } from "@/lib/range-page";
import { routeSlug } from "@/lib/route-slug";
import { nzServiceDayString, serviceDayLabel } from "@/lib/time";
import { buildHref } from "@/lib/utils";
import type { Metadata } from "next";

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

/** Longest id a card URL carries; anything longer is not a real route, trip or stop. */
const ID_MAX = 96;

/**
 * An id from a query, or null when it is missing or implausibly long.
 * @param v - The raw value.
 * @returns The id, or null.
 */
function cleanId(v: string | null | undefined): string | null {
  return v && v.length <= ID_MAX ? v : null;
}

/** What a route page's card describes: one day, or a week (null period = the last 7 days). */
export interface RouteCard {
  kind: "route";
  id: string;
  window: "day" | "week";
  day: string | null;
  period: string | null;
}

/** What a run's card describes: the trip on one service day, or its latest day when null. */
export interface TripCard {
  kind: "trip";
  id: string;
  tripId: string;
  day: string | null;
}

/** What a stop page's card describes: one day, or today when null. */
export interface StopCard {
  kind: "stop";
  id: string;
  day: string | null;
}

/** A card about one route, run or stop. */
export type SubjectCard = RouteCard | TripCard | StopCard;

/** Any card the handler can draw. */
export type Card = ({ kind: "home" } & HomeCard) | SubjectCard;

/**
 * Validate a route page's query into its card. Any window but the day is the
 * week view, as on the page, and a week's period is the Monday it starts on.
 * @param id - The route segment, version suffix or not.
 * @param sp - The page's raw query.
 * @param sp.window - The window param.
 * @param sp.day - The day param.
 * @param sp.period - The week param.
 * @returns The card state.
 */
export function parseRouteCard(
  id: string,
  sp: { window?: string; day?: string; period?: string },
): RouteCard {
  const week = sp.window !== undefined && sp.window !== "day";
  return {
    kind: "route",
    id: routeSlug(id),
    window: week ? "week" : "day",
    day: week ? null : resolveRequestedDay(sp.day),
    period: week ? resolveRequestedDay(sp.period) : null,
  };
}

/**
 * Validate a trip page's query into its card. The page keys the run by an
 * instant (`?d=`), which names its service day; the card keeps only the day.
 * @param id - The route segment.
 * @param tripId - The trip id segment.
 * @param d - The run's instant, if the link carries one.
 * @returns The card state.
 */
export function parseTripCard(id: string, tripId: string, d: string | undefined): TripCard {
  const at = d ? new Date(d) : null;
  return {
    kind: "trip",
    id: routeSlug(id),
    tripId,
    day: at && !Number.isNaN(at.getTime()) ? nzServiceDayString(at) : null,
  };
}

/**
 * Validate a stop page's query into its card.
 * @param id - The decoded stop id.
 * @param sp - The page's raw query.
 * @param sp.day - The day param.
 * @returns The card state.
 */
export function parseStopCard(id: string, sp: { day?: string }): StopCard {
  return { kind: "stop", id, day: resolveRequestedDay(sp.day) };
}

/**
 * The card URL for a route, run or stop card. Like {@link homeCardPath} it
 * carries only validated state, so every spelling of one view shares a card.
 * @param card - The card state.
 * @returns The `/api/og` path with its query.
 */
export function subjectCardPath(card: SubjectCard): string {
  switch (card.kind) {
    case "route":
      return buildHref("/api/og", {
        card: "route",
        id: card.id,
        window: card.window === "week" ? "week" : undefined,
        day: card.day ?? undefined,
        period: card.period ?? undefined,
      });
    case "trip":
      return buildHref("/api/og", {
        card: "trip",
        id: card.id,
        trip: card.tripId,
        day: card.day ?? undefined,
      });
    case "stop":
      return buildHref("/api/og", { card: "stop", id: card.id, day: card.day ?? undefined });
  }
}

/**
 * Parse any card URL's query back into its state. A route, trip or stop card
 * missing its id falls back to the home card, which always has something to show.
 * @param query - The `/api/og` request's search params.
 * @returns The card state.
 */
export function parseCardQuery(query: URLSearchParams): Card {
  const kind = query.get("card");
  const id = cleanId(query.get("id"));
  /**
   * One query value, with a missing one as undefined.
   * @param k - The param name.
   * @returns The value, or undefined.
   */
  const get = (k: string): string | undefined => query.get(k) ?? undefined;
  if (kind === "route" && id) {
    return parseRouteCard(id, { window: get("window"), day: get("day"), period: get("period") });
  }
  if (kind === "trip" && id) {
    const tripId = cleanId(query.get("trip"));
    if (tripId) return { kind: "trip", id, tripId, day: resolveRequestedDay(get("day")) };
  }
  if (kind === "stop" && id) return parseStopCard(id, { day: get("day") });
  return { kind: "home", ...parseHomeCardQuery(query) };
}

/**
 * The period a route, run or stop card names, as a title suffix: empty for
 * the page's own default (today, or a run's latest day), otherwise
 * ", Sun 20 Sep", ", week of Mon 14 Sep" or ", last 7 days".
 * @param card - The card state.
 * @returns The suffix.
 */
export function cardWhenSuffix(card: SubjectCard): string {
  if (card.kind === "route" && card.window === "week") {
    return card.period ? `, week of ${serviceDayLabel(card.period)}` : ", last 7 days";
  }
  return card.day ? `, ${serviceDayLabel(card.day)}` : "";
}

/**
 * The Open Graph and Twitter halves of a page's metadata, pointing both at
 * one card image.
 * @param title - The shared link's title.
 * @param description - The shared link's description.
 * @param path - The card's `/api/og` path.
 * @returns The `openGraph` and `twitter` metadata.
 */
export function cardMetadata(
  title: string,
  description: string,
  path: string,
): Pick<Metadata, "openGraph" | "twitter"> {
  const image = { url: path, width: CARD_WIDTH, height: CARD_HEIGHT, alt: title };
  return {
    openGraph: {
      title,
      description,
      siteName: "AT Route Performance",
      type: "website",
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
