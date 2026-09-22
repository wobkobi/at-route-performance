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
export type CardMode = (typeof MODES)[number];

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

/**
 * A mode param, or null for every mode.
 * @param v - The raw value.
 * @returns The mode, or null.
 */
function parseMode(v: string | undefined): CardMode | null {
  return MODES.find((m) => m === v) ?? null;
}

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

/** The raw query a windowed card is built from: the page's own search params. */
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
 * names a day or filter the page would not show. `/routes` and
 * `/cancellations` take the same query, so their cards parse it here too.
 * @param sp - The raw params (from the page, or from the card URL).
 * @returns The card state.
 */
export function parseHomeCard(sp: HomeCardParams): HomeCard {
  const window = parseRangeWindow(sp.window);
  let period: string | null = null;
  if (window === "week") period = resolveRequestedDay(sp.period);
  if (window === "month") period = resolveRequestedMonth(sp.period);
  return {
    window,
    day: window === "day" ? resolveRequestedDay(sp.day) : null,
    period,
    mode: parseMode(sp.mode),
    includeSchool: sp.school === "1",
  };
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

/** Which shame board a card is for. */
export type ShameBoard = "trip" | "route" | "stop";

/** What a shame board's card describes. */
export interface ShameCard {
  kind: "shame";
  board: ShameBoard;
  window: RangeWindow;
  day: string | null;
  period: string | null;
  mode: CardMode | null;
  includeSchool: boolean;
}

/** What a list page's card describes: the Routes or Cancellations page over its window. */
export type ListCard = { kind: "list"; page: "routes" | "cancellations" } & HomeCard;

/** A card about one route, run or stop. */
export type SubjectCard = RouteCard | TripCard | StopCard;

/** Any card the handler can draw. */
export type Card = ({ kind: "home" } & HomeCard) | SubjectCard | ShameCard | ListCard;

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
 * Validate a shame board's query into its card. The boards read `window` as
 * week, month or (anything else) day, as `parseShameParams` does.
 * @param board - Which shame board.
 * @param sp - The page's raw query.
 * @returns The card state.
 */
export function parseShameCard(board: ShameBoard, sp: HomeCardParams): ShameCard {
  const window: RangeWindow = sp.window === "week" || sp.window === "month" ? sp.window : "day";
  let period: string | null = null;
  if (window === "week") period = resolveRequestedDay(sp.period);
  if (window === "month") period = resolveRequestedMonth(sp.period);
  return {
    kind: "shame",
    board,
    window,
    day: window === "day" ? resolveRequestedDay(sp.day) : null,
    period,
    mode: parseMode(sp.mode),
    includeSchool: sp.school === "1",
  };
}

/**
 * Validate a list page's query into its card. Both take the home page's query;
 * the Routes explorer mirrors its mode and school filters into the same two
 * params, so a shared filtered list carries them too.
 * @param page - Which list page.
 * @param sp - The page's raw query.
 * @returns The card state.
 */
export function parseListCard(page: ListCard["page"], sp: HomeCardParams): ListCard {
  return { kind: "list", page, ...parseHomeCard(sp) };
}

/**
 * The card URL for any card, relative so Next resolves it against the
 * deployment's own origin. Carries only validated state, so every spelling of
 * one view shares a cached card.
 * @param card - The card state.
 * @returns The `/api/og` path with its query.
 */
export function cardPath(card: Card): string {
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
    case "home":
    case "shame":
    case "list":
      return buildHref("/api/og", {
        card: card.kind,
        board: card.kind === "shame" ? card.board : undefined,
        page: card.kind === "list" ? card.page : undefined,
        window: card.window === "day" ? undefined : card.window,
        day: card.day ?? undefined,
        period: card.period ?? undefined,
        mode: card.mode ?? undefined,
        school: card.includeSchool ? "1" : undefined,
      });
  }
}

/**
 * The card URL for a home page view.
 * @param sp - The page's raw query.
 * @returns The `/api/og` path with its query.
 */
export function homeCardPath(sp: HomeCardParams): string {
  return cardPath({ kind: "home", ...parseHomeCard(sp) });
}

/**
 * Parse a card URL's query back into the home card's state.
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

/** Shame pages a card URL may name. */
const SHAME_BOARDS: readonly ShameBoard[] = ["trip", "route", "stop"];

/**
 * Parse any card URL's query back into its state. A card missing its id, or
 * naming a board or page that does not exist, falls back to the home card,
 * which always has something to show.
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
  const windowed: HomeCardParams = {
    window: get("window"),
    day: get("day"),
    period: get("period"),
    mode: get("mode"),
    school: get("school"),
  };
  const board = SHAME_BOARDS.find((b) => b === get("board"));
  if (kind === "shame" && board) return parseShameCard(board, windowed);
  const page = get("page");
  if (kind === "list" && (page === "routes" || page === "cancellations")) {
    return parseListCard(page, windowed);
  }
  return { kind: "home", ...parseHomeCard(windowed) };
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
 * The page title a home card's link unfurls with, worded like the page's own
 * heading. The card image carries the figures. A day of null is today; the
 * page resolves a bare link that opens on another day into that day first.
 * @param c - The card state.
 * @returns The title.
 */
export function homeCardTitle(c: HomeCard): string {
  const filter = cardFilterLabel(c.mode, c.includeSchool);
  let when: string;
  if (c.window === "day") when = c.day ? `on ${serviceDayLabel(c.day)}` : "today";
  else if (c.window === "week")
    when = c.period ? `the week of ${serviceDayLabel(c.period)}` : "over the last 7 days";
  else when = c.period ? `in ${monthLabel(c.period)}` : "this month";
  return `How bad was it ${when}?${filter ? ` (${filter})` : ""}`;
}

/**
 * The period a card names, as a title suffix: empty for the page's own
 * default (today, a run's latest day, the current week or month), otherwise
 * ", Sun 20 Sep", ", week of Mon 14 Sep" or ", September 2026". A route's week
 * with no period is the rolling ", last 7 days".
 * @param card - The card state.
 * @returns The suffix.
 */
export function cardWhenSuffix(card: SubjectCard | ShameCard | ListCard): string {
  if (card.kind === "route" && card.window === "week" && !card.period) return ", last 7 days";
  if ("window" in card && card.window === "week") {
    return card.period ? `, week of ${serviceDayLabel(card.period)}` : "";
  }
  if ("window" in card && card.window === "month") {
    return card.period ? `, ${monthLabel(card.period)}` : "";
  }
  return card.day ? `, ${serviceDayLabel(card.day)}` : "";
}

/** Each shame page's heading, by board, before its window's noun. */
const SHAME_HEADS: Record<ShameBoard, string> = {
  trip: "Worst trips of the",
  route: "Worst routes of the",
  stop: "Worst stops of the",
};

/**
 * The title a shame or list page's link unfurls with, from the query alone:
 * the page's heading, the period and any filter.
 * @param card - The card state.
 * @returns The title.
 */
export function listCardTitle(card: ShameCard | ListCard): string {
  const filter = cardFilterLabel(card.mode, card.includeSchool);
  let head: string;
  if (card.kind === "shame") head = `${SHAME_HEADS[card.board]} ${card.window}`;
  else head = card.page === "routes" ? "Routes" : "Cancellations";
  return `${head}${cardWhenSuffix(card)}${filter ? ` (${filter})` : ""}`;
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
