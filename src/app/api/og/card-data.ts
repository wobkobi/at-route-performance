// src/app/api/og/card-data.ts
// What each card shows, resolved the way its page resolves it: the same
// queries, the same thresholds and the same early-morning fallback to the
// latest full day, so a card never prints a figure its page would not.

import { CANCELLATION_BADGE_MEANING, cancellationStage } from "@/lib/cancellation";
import type { NetworkCancelledTrip } from "@/lib/data";
import {
  findCanonicalRouteSlug,
  findSuccessorRouteSlug,
  getEarliestDataDay,
  getLatestEventDate,
  getLatestTripDay,
  getNetworkCancelledTrips,
  getRankings,
  getRouteDailyStats,
  getRouteStats,
  getShameOfDay,
  getShameOfWeek,
  getShameRouteOfDay,
  getShameRouteOfWeek,
  getStopStats,
  getTripCancellation,
  getTripScheduledStops,
  getTripTimeline,
  getWorstStops,
  getWorstStopsOfDay,
  getWorstStopsOfWeek,
  TODAY_REVALIDATE,
} from "@/lib/data";
import {
  formatDuration,
  formatGtfsTime,
  OFF_SCHEDULE_TONE_CLASS,
  offScheduleValue,
} from "@/lib/format";
import { lineName } from "@/lib/line-name";
import {
  cardFilterLabel,
  monthLabel,
  type HomeCard,
  type ListCard,
  type RouteCard,
  type ShameCard,
  type StopCard,
  type TripCard,
} from "@/lib/og";
import { earlyToleranceFor, isOnTime, ON_TIME_LATE_SEC } from "@/lib/on-time";
import { filterLiveHours, maybeFallbackDay, resolveRangeView } from "@/lib/page-nav";
import { periodRangeNav } from "@/lib/range-page";
import { MIN_BOARD_EVENTS, summariseRows, visibleRows } from "@/lib/rankings";
import { routeSlug } from "@/lib/route-slug";
import { aggregateWeek } from "@/lib/route-week";
import { isCrownable, pickWorst, WEEK_REVALIDATE } from "@/lib/shame-page";
import {
  nzClockTime,
  nzHourLabel,
  nzMonthKey,
  nzServiceDayRange,
  nzServiceDayString,
  nzWeekRange,
  serviceDatesInRange,
  serviceDayLabel,
  weekRangeLabel,
  type DateRange,
} from "@/lib/time";
import { dayVerdict } from "@/lib/verdict";
import type { FleetSummary, ShameRouteRow, ShameTrip } from "@/types/dashboard";
import type { SubjectBodyProps } from "./card-layout";

/** The stop page's cache lifetime, shared so the card reads the same entries. */
const STOP_REVALIDATE = 300;

/** What the home card shows once its view is resolved. */
export interface HomeCardData {
  /** The period named in the eyebrow: a day, a span of days, or a month. */
  when: string;
  summary: FleetSummary;
  /** Whether the whole period is in the past, so the card can be cached long. */
  complete: boolean;
}

/** What a subject, shame or list card shows once its view is resolved. */
export interface SubjectCardData {
  eyebrow: string;
  body: SubjectBodyProps;
  /** Whether everything the card describes is in the past. */
  complete: boolean;
}

/**
 * Format an arrivals count the way the pages do.
 * @param n - The count.
 * @returns "1,234 arrivals" (or "1 arrival").
 */
function arrivals(n: number): string {
  return `${n.toLocaleString("en-NZ")} arrival${n === 1 ? "" : "s"}`;
}

/**
 * Resolve a home card's view the way the home page does: the requested day, or
 * today falling back to the latest full day while today is still too sparse;
 * a week or month anchored on the latest day with data.
 * @param card - The card state.
 * @returns The period label, the figures and whether the period is over.
 */
export async function homeCardData(card: HomeCard): Promise<HomeCardData> {
  const today = nzServiceDayString();
  const filter = { mode: card.mode, includeSchool: card.includeSchool };
  if (card.window === "day") {
    let range = nzServiceDayRange(card.day ?? new Date());
    let rows = await getRankings(range, ON_TIME_LATE_SEC, TODAY_REVALIDATE);
    const fallback = await maybeFallbackDay(
      card.day,
      !rows.some((r) => r.events >= MIN_BOARD_EVENTS),
      MIN_BOARD_EVENTS,
    );
    if (fallback) {
      range = nzServiceDayRange(fallback);
      rows = await getRankings(range, ON_TIME_LATE_SEC, TODAY_REVALIDATE);
    }
    const date = nzServiceDayString(range.start);
    return {
      when: serviceDayLabel(date),
      summary: summariseRows(visibleRows(rows, filter)),
      complete: date < today,
    };
  }
  const period = await resolvePeriod(card.window, card.period);
  const rows = await getRankings(period.range, ON_TIME_LATE_SEC, TODAY_REVALIDATE);
  return {
    when: period.when,
    summary: summariseRows(visibleRows(rows, filter)),
    complete: period.complete,
  };
}

/**
 * Resolve a week or month the way the home, Routes and Cancellations pages do:
 * anchored on the latest day with data, and named by the days it covers.
 * @param window - The week or month window.
 * @param rawPeriod - The validated period, or null for the current one.
 * @returns The range, its label and whether it is over.
 */
async function resolvePeriod(
  window: "week" | "month",
  rawPeriod: string | null,
): Promise<{ range: DateRange; when: string; complete: boolean }> {
  const today = nzServiceDayString();
  const [latest, earliest] = await Promise.all([getLatestEventDate(), getEarliestDataDay(1)]);
  const anchor = latest ?? new Date();
  const { range } = periodRangeNav("/", window, rawPeriod ?? undefined, anchor, earliest);
  // Name the days the figures cover: a week's dates up to today, not beyond.
  const dates = serviceDatesInRange(range);
  const shown = dates.filter((d) => d <= today);
  const first = shown[0] ?? dates[0] ?? today;
  const last = shown.at(-1) ?? today;
  return {
    range,
    when:
      window === "month"
        ? monthLabel(rawPeriod ?? nzMonthKey(anchor))
        : `${serviceDayLabel(first)} to ${serviceDayLabel(last)}`,
    complete: (dates.at(-1) ?? today) < today,
  };
}

/**
 * The on-time share as a hero figure, coloured by the verdict band it falls in
 * so a route's card reads on the same scale as the home page's word.
 * @param pct - The on-time share, or null.
 * @returns The hero, or null when there is no share.
 */
function onTimeHero(pct: number | null | undefined): SubjectBodyProps["hero"] {
  if (pct == null) return null;
  return { text: `${pct.toFixed(1)}%`, toneClass: dayVerdict(pct)?.toneClass ?? "text-at-ink" };
}

/**
 * Resolve a route card as the route page does: the day view with its fallback,
 * or the week folded from the route's daily summaries.
 * @param card - The card state.
 * @returns The card, or null when no such route exists.
 */
export async function routeCardData(card: RouteCard): Promise<SubjectCardData | null> {
  const canon = await findCanonicalRouteSlug(card.id);
  if (canon === null) return null;
  // A line retired by the CRL rename redirects to its successor on the page,
  // so its card describes the successor too.
  const slug = (await findSuccessorRouteSlug(canon)) ?? canon;
  const today = nzServiceDayString();

  let range = nzServiceDayRange(card.day ?? new Date());
  let stats = await getRouteStats({
    routeId: slug,
    from: range.start,
    to: range.end,
    thresholdSec: ON_TIME_LATE_SEC,
  });
  const route = stats.route;
  const glyph = route
    ? {
        mode: route.mode,
        shortName: route.shortName,
        longName: route.longName,
        colour: route.colour,
      }
    : null;
  const name = route?.shortName ?? slug;
  const subname = route ? (lineName(route.mode, route.shortName) ?? route.longName) : null;

  if (card.window === "week") {
    const fixed = card.period ? nzWeekRange(card.period) : null;
    const week = aggregateWeek(await getRouteDailyStats(slug, fixed?.start, fixed?.end));
    const lastDay = fixed ? serviceDatesInRange(fixed).at(-1) : undefined;
    return {
      eyebrow: `Route - ${fixed ? weekRangeLabel(fixed) : "Last 7 days"}`,
      body: {
        route: glyph,
        name,
        subname: subname === name ? null : subname,
        hero: onTimeHero(week?.on_time_pct),
        lines: week
          ? [
              `of ${arrivals(week.events)} on time`,
              `${formatDuration(week.avg_abs_delay_sec)} off schedule on average`,
            ]
          : [],
      },
      complete: lastDay !== undefined && lastDay < today,
    };
  }

  const fallback = await maybeFallbackDay(
    card.day,
    (stats.summary?.events ?? 0) === 0,
    MIN_BOARD_EVENTS,
  );
  if (fallback) {
    range = nzServiceDayRange(fallback);
    stats = await getRouteStats({
      routeId: slug,
      from: range.start,
      to: range.end,
      thresholdSec: ON_TIME_LATE_SEC,
    });
  }
  const date = nzServiceDayString(range.start);
  const summary = stats.summary;
  return {
    eyebrow: `Route - ${serviceDayLabel(date)}`,
    body: {
      route: glyph,
      name,
      subname: subname === name ? null : subname,
      hero: onTimeHero(summary?.on_time_pct),
      lines:
        summary && summary.on_time_pct != null
          ? [
              `of ${arrivals(summary.events)} on time`,
              summary.avg_abs_delay_sec == null
                ? ""
                : `${formatDuration(summary.avg_abs_delay_sec)} off schedule on average`,
            ].filter(Boolean)
          : [],
    },
    complete: date < today,
  };
}

/**
 * Resolve a run's card as the trip page does: the run on its day, AT's
 * cancellation flag read against its recorded arrivals, and how far off it ran
 * across the stops it served.
 * @param card - The card state.
 * @returns The card, or null when nothing knows this run.
 */
export async function tripCardData(card: TripCard): Promise<SubjectCardData | null> {
  const day = card.day ? nzServiceDayRange(card.day) : await getLatestTripDay(card.tripId);
  const [timeline, flag, scheduled] = await Promise.all([
    getTripTimeline(card.tripId, card.id, day ?? undefined),
    getTripCancellation(card.tripId, day),
    // The schedule only names the destination and the start; an AT outage
    // should cost the card those, not the whole card.
    getTripScheduledStops(card.tripId).catch(() => []),
  ]);
  const { route, stops } = timeline;
  if (!route && stops.length === 0 && scheduled.length === 0) return null;
  const mode = route?.mode ?? "BUS";

  /**
   * When the vehicle reached a recorded stop.
   * @param s - A recorded stop.
   * @returns The ISO arrival instant (schedule plus deviation).
   */
  const actualAt = (s: (typeof stops)[number]): string =>
    new Date(Date.parse(s.scheduled_at) + s.deviation_sec * 1000).toISOString();
  const stage = flag ? cancellationStage(flag.detected_at, stops.map(actualAt)) : null;

  const departing = stops[0]
    ? nzClockTime(stops[0].scheduled_at)
    : scheduled[0]?.departure_time
      ? formatGtfsTime(scheduled[0].departure_time)
      : null;
  const destination = scheduled.at(-1)?.name ?? stops.at(-1)?.name ?? null;
  const date = day ? nzServiceDayString(day.start) : null;

  let hero: SubjectBodyProps["hero"] = null;
  let lines: string[] = [];
  if (stage === "before" || stage === "mid-trip") {
    hero = { text: stage === "before" ? "Cancelled" : "Cut short", toneClass: "text-at-late" };
    lines = [CANCELLATION_BADGE_MEANING[stage]];
  } else if (stops.length > 0) {
    const signed = stops.reduce((s, x) => s + x.deviation_sec, 0) / stops.length;
    const abs = stops.reduce((s, x) => s + Math.abs(x.deviation_sec), 0) / stops.length;
    const value = offScheduleValue(signed, abs, mode);
    hero = { text: value.text, toneClass: OFF_SCHEDULE_TONE_CLASS[value.tone] };
    lines = [`on average across ${stops.length} stop${stops.length === 1 ? "" : "s"}`];
    if (stage === "ran") lines.push(CANCELLATION_BADGE_MEANING.ran);
  }

  const when = [date ? serviceDayLabel(date) : null, departing].filter(Boolean).join(", ");
  return {
    eyebrow: when ? `Run - ${when}` : "Run",
    body: {
      route: route
        ? {
            mode: route.mode,
            shortName: route.shortName,
            longName: route.longName,
            colour: route.colour,
          }
        : null,
      name: route?.shortName ?? card.id,
      subname: destination ? `to ${destination}` : null,
      hero,
      lines,
    },
    complete: date !== null && date < nzServiceDayString(),
  };
}

/**
 * Resolve a stop's card as the stop page does, fallback included. A stop mixes
 * modes, so its hero is the plain distance off schedule with no on-time colour.
 * @param card - The card state.
 * @returns The card, or null when no such stop exists.
 */
export async function stopCardData(card: StopCard): Promise<SubjectCardData | null> {
  let range = nzServiceDayRange(card.day ?? new Date());
  let stats = await getStopStats(card.id, range, ON_TIME_LATE_SEC, STOP_REVALIDATE);
  if (!stats) return null;
  const fallback = await maybeFallbackDay(
    card.day,
    (stats.summary?.events ?? 0) === 0,
    MIN_BOARD_EVENTS,
  );
  if (fallback) {
    range = nzServiceDayRange(fallback);
    stats = (await getStopStats(card.id, range, ON_TIME_LATE_SEC, STOP_REVALIDATE)) ?? stats;
  }
  const date = nzServiceDayString(range.start);
  const { summary } = stats;
  const abs = summary?.avg_abs_delay_sec;
  return {
    eyebrow: `Stop - ${serviceDayLabel(date)}`,
    body: {
      route: null,
      name: stats.stop.name,
      subname: `${stats.routes_count} route${stats.routes_count === 1 ? "" : "s"} called here`,
      hero: abs == null ? null : { text: formatDuration(abs), toneClass: "text-at-ink" },
      lines:
        summary && abs != null
          ? [
              `off schedule on average, across ${arrivals(summary.events)}`,
              summary.on_time_pct == null ? "" : `${summary.on_time_pct.toFixed(1)}% on time`,
            ].filter(Boolean)
          : [],
    },
    complete: date < nzServiceDayString(),
  };
}

/**
 * An eyebrow from its parts, dropping the empty ones.
 * @param parts - The heading, the period and the filter.
 * @returns "Worst run - Sun 20 Sep - Trains".
 */
function eyebrowOf(...parts: (string | null)[]): string {
  return parts.filter(Boolean).join(" - ");
}

/**
 * A route glyph from a shame row's route fields.
 * @param r - The row.
 * @returns The glyph route.
 */
function glyphOf(r: ShameTrip | ShameRouteRow): SubjectBodyProps["route"] {
  return { mode: r.mode, shortName: r.short_name, longName: r.long_name, colour: r.colour ?? null };
}

/**
 * The name a shame row's route goes by on its board.
 * @param r - The row.
 * @returns The short name, the long name, or the slug.
 */
function routeNameOf(r: ShameTrip | ShameRouteRow): string {
  return r.short_name || r.long_name || routeSlug(r.route_id);
}

/**
 * A run's headsign as the board prints it, or null when it is missing or only
 * a number (which names nothing).
 * @param t - The run.
 * @returns "to Britomart", or null.
 */
function destinationOf(t: ShameTrip): string | null {
  return t.headsign && /\D/.test(t.headsign) ? `to ${t.headsign}` : null;
}

/**
 * The hero for a row with a signed and an absolute deviation, as the boards
 * print it through `offScheduleValue`.
 * @param signed - The signed average deviation.
 * @param abs - The average absolute deviation.
 * @param mode - The row's mode, for its on-time window.
 * @returns The hero.
 */
function offHero(signed: number, abs: number, mode: string): SubjectBodyProps["hero"] {
  const value = offScheduleValue(signed, abs, mode);
  return { text: value.text, toneClass: OFF_SCHEDULE_TONE_CLASS[value.tone] };
}

/** Each shame card's heading and the noun its empty state uses. */
const SHAME_HEADINGS = {
  overview: { head: "Shame of the day", noun: "run" },
  trip: { head: "Worst run", noun: "run" },
  route: { head: "Worst route", noun: "route" },
  stop: { head: "Worst stop", noun: "stop" },
} as const;

/**
 * The body for a board whose rows were ranked and none was bad enough to crown.
 * @param noun - What the board ranks.
 * @returns The body.
 */
function nothingStoodOut(noun: string): SubjectBodyProps {
  return {
    route: null,
    name: null,
    subname: null,
    hero: { text: "Nothing stood out", toneClass: "text-at-ontime" },
    lines: [`No ${noun} averaged more than ${formatDuration(ON_TIME_LATE_SEC)} off schedule`],
  };
}

/** The body for a board with nothing ranked at all. */
const NOTHING_RANKED: SubjectBodyProps = {
  route: null,
  name: null,
  subname: null,
  hero: null,
  lines: [],
};

/**
 * Resolve a shame day the way the shame pages do: the requested day, or today
 * falling back to the latest full day while today has no rows yet.
 * @param card - The card state.
 * @param fetch - The board's day query.
 * @returns The service day shown and its rows.
 */
async function shameDay<T extends { hours: unknown[] }>(
  card: ShameCard,
  fetch: (range: DateRange) => Promise<T>,
): Promise<{ date: string; data: T }> {
  let range = nzServiceDayRange(card.day ?? new Date());
  let data = await fetch(range);
  const fallback = await maybeFallbackDay(card.day, data.hours.length === 0, MIN_BOARD_EVENTS);
  if (fallback) {
    range = nzServiceDayRange(fallback);
    data = await fetch(range);
  }
  return { date: nzServiceDayString(range.start), data };
}

/**
 * Resolve a shame board's week or month as its page does, named the way every
 * other card names a period rather than in the board's compact "14/09" form.
 * @param card - The card state, on a week or month window.
 * @param window - The window.
 * @returns The range, its label, and whether it is over.
 */
async function shameRange(
  card: ShameCard,
  window: "week" | "month",
): Promise<{ range: DateRange; when: string; complete: boolean }> {
  const today = nzServiceDayString();
  const earliest = await getEarliestDataDay(1);
  const { activeRange } = resolveRangeView(window, card.period ?? undefined, earliest, () => "");
  const dates = serviceDatesInRange(activeRange);
  const shown = dates.filter((d) => d <= today);
  const first = shown[0] ?? dates[0] ?? today;
  const last = shown.at(-1) ?? today;
  return {
    range: activeRange,
    when:
      window === "month"
        ? monthLabel(first.slice(0, 7))
        : `${serviceDayLabel(first)} to ${serviceDayLabel(last)}`,
    complete: (dates.at(-1) ?? today) < today,
  };
}

/**
 * The body naming one run, as the worst-run board's row and the Shame of the
 * day card name it.
 * @param t - The run.
 * @param dated - Whether to name its day (on a week or month card).
 * @returns The body.
 */
function runBody(t: ShameTrip, dated: boolean): SubjectBodyProps {
  const time = nzClockTime(t.scheduled_start);
  return {
    route: glyphOf(t),
    name: routeNameOf(t),
    subname: destinationOf(t),
    hero: offHero(t.avg_delay_sec, t.avg_abs_delay_sec, t.mode),
    lines: [
      `on average across ${t.stops} stops`,
      dated && t.date ? `The ${time} run on ${serviceDayLabel(t.date)}` : `The ${time} run`,
    ],
  };
}

/**
 * Resolve the card for `/shame` or one of its boards. Each names what its page
 * crowns: the run, route or stop, with the figure its row prints. On a day the
 * boards crown only a row past the late bound, and the overview's run card uses
 * its own on-time test, so a quiet day reads "Nothing stood out" on both.
 * @param card - The card state.
 * @returns The card.
 */
export async function shameCardData(card: ShameCard): Promise<SubjectCardData> {
  const { head, noun } = SHAME_HEADINGS[card.board];
  const filter = { mode: card.mode, includeSchool: card.includeSchool };
  const filterLabel = cardFilterLabel(card.mode, card.includeSchool);
  const today = nzServiceDayString();

  if (card.board === "overview") {
    const { date, data } = await shameDay(card, async (range) => {
      const [trip, route, stops] = await Promise.all([
        getShameOfDay(range, filter, TODAY_REVALIDATE),
        getShameRouteOfDay(range, filter, TODAY_REVALIDATE),
        getWorstStops(range, filter, 1, TODAY_REVALIDATE),
      ]);
      // The page falls back only when both hourly boards are empty.
      return { trip, route, stop: stops[0] ?? null, hours: [...trip.hours, ...route.hours] };
    });
    const t = data.trip.worst;
    let body: SubjectBodyProps;
    if (!t) body = NOTHING_RANKED;
    else if (t.avg_abs_delay_sec <= earlyToleranceFor(t.mode) || isOnTime(t.avg_delay_sec, t.mode))
      body = nothingStoodOut(noun);
    else body = runBody(t, false);
    // The page's other two cards, one line each, under the run.
    const r = data.route.worst;
    const extra = [
      r
        ? `Worst route: ${routeNameOf(r)}, ${offScheduleValue(r.avg_delay_sec, r.avg_abs_delay_sec, r.mode).text}`
        : null,
      data.stop ? `Worst stop: ${data.stop.name}` : null,
    ].filter((l): l is string => l !== null);
    return {
      eyebrow: eyebrowOf(head, serviceDayLabel(date), filterLabel),
      body: body.hero ? { ...body, lines: [...body.lines.slice(0, 1), ...extra] } : body,
      complete: date < today,
    };
  }

  if (card.window === "week" || card.window === "month") {
    const period = await shameRange(card, card.window);
    let body: SubjectBodyProps = NOTHING_RANKED;
    if (card.board === "trip") {
      const t = (await getShameOfWeek(period.range, filter, WEEK_REVALIDATE)).worst;
      if (t) body = runBody(t, true);
    } else if (card.board === "route") {
      const r = (await getShameRouteOfWeek(period.range, filter, WEEK_REVALIDATE)).worst;
      if (r)
        body = {
          route: glyphOf(r),
          name: routeNameOf(r),
          subname: null,
          hero: offHero(r.avg_delay_sec, r.avg_abs_delay_sec, r.mode),
          lines: [
            r.date ? `on average on ${serviceDayLabel(r.date)}` : "on average",
            `${arrivals(r.events)} that day`,
          ],
        };
    } else {
      const s = (await getWorstStopsOfWeek(period.range, filter, WEEK_REVALIDATE)).worst;
      if (s)
        body = {
          route: null,
          name: s.name,
          subname: null,
          hero: { text: formatDuration(s.avg_abs_delay_sec), toneClass: "text-at-ink" },
          lines: [
            `off schedule on average on ${serviceDayLabel(s.date)}`,
            `${arrivals(s.events)} that day`,
          ],
        };
    }
    return {
      eyebrow: eyebrowOf(head, period.when, filterLabel),
      body,
      complete: period.complete,
    };
  }

  // Day boards: the worst hour among the hours already over, crowned only past
  // the late bound, as the board's own badge is.
  let date: string;
  let body: SubjectBodyProps;
  if (card.board === "trip") {
    const day = await shameDay(card, (range) => getShameOfDay(range, filter, TODAY_REVALIDATE));
    date = day.date;
    const hours = filterLiveHours(day.data.hours, date);
    const t = pickWorst(hours);
    if (!t) body = NOTHING_RANKED;
    else if (!isCrownable(t)) body = nothingStoodOut(noun);
    else body = runBody(t, false);
  } else if (card.board === "route") {
    const day = await shameDay(card, (range) =>
      getShameRouteOfDay(range, filter, TODAY_REVALIDATE),
    );
    date = day.date;
    const r = pickWorst(filterLiveHours(day.data.hours, date));
    if (!r) body = NOTHING_RANKED;
    else if (!isCrownable(r)) body = nothingStoodOut(noun);
    else
      body = {
        route: glyphOf(r),
        name: routeNameOf(r),
        subname: null,
        hero: offHero(r.avg_delay_sec, r.avg_abs_delay_sec, r.mode),
        lines: [
          `on average in the ${nzHourLabel(r.hour)} hour`,
          `${arrivals(r.events)} in that hour`,
        ],
      };
  } else {
    const day = await shameDay(card, (range) =>
      getWorstStopsOfDay(range, filter, TODAY_REVALIDATE),
    );
    date = day.date;
    const s = pickWorst(filterLiveHours(day.data.hours, date));
    if (!s) body = NOTHING_RANKED;
    else if (!isCrownable(s)) body = nothingStoodOut(noun);
    else
      body = {
        route: null,
        name: s.name,
        subname: null,
        hero: { text: formatDuration(s.avg_abs_delay_sec), toneClass: "text-at-ink" },
        lines: [
          `off schedule on average in the ${nzHourLabel(s.hour)} hour`,
          `${arrivals(s.events)} in that hour`,
        ],
      };
  }
  return {
    eyebrow: eyebrowOf(head, serviceDayLabel(date), filterLabel),
    body,
    complete: date < today,
  };
}

/**
 * Resolve the Routes or Cancellations card as its page resolves the window:
 * the day with its fallback, or the week or month anchored on the latest data.
 * Routes leads with how many routes ran; Cancellations with how many trips AT
 * flagged, under the page's own mode and school filter.
 * @param card - The card state.
 * @returns The card.
 */
export async function listCardData(card: ListCard): Promise<SubjectCardData> {
  const filter = { mode: card.mode, includeSchool: card.includeSchool };
  const today = nzServiceDayString();
  const isRoutes = card.page === "routes";
  /**
   * A window's rows: the rankings for Routes, the flagged trips for Cancellations.
   * @param range - The window.
   * @returns The rows and whether there is anything to show.
   */
  const fetch = async (
    range: DateRange,
  ): Promise<{ routes: FleetSummary | null; count: number; trips: NetworkCancelledTrip[] }> => {
    if (isRoutes) {
      const rows = visibleRows(
        await getRankings(range, ON_TIME_LATE_SEC, TODAY_REVALIDATE),
        filter,
      );
      const ran = rows.filter((r) => r.events > 0);
      return { routes: summariseRows(ran), count: ran.length, trips: [] };
    }
    const trips = (await getNetworkCancelledTrips(range)).filter(
      (t) => (!card.mode || t.mode === card.mode) && (card.includeSchool || !t.school),
    );
    return { routes: null, count: trips.length, trips };
  };

  let when: string;
  let complete: boolean;
  let data: Awaited<ReturnType<typeof fetch>>;
  if (card.window === "day") {
    let range = nzServiceDayRange(card.day ?? new Date());
    data = await fetch(range);
    // Each page falls back on its own emptiness test, before any filter.
    const empty = isRoutes
      ? !(await getRankings(range, ON_TIME_LATE_SEC, TODAY_REVALIDATE)).some(
          (r) => r.events >= MIN_BOARD_EVENTS,
        )
      : (await getNetworkCancelledTrips(range)).length === 0;
    const fallback = await maybeFallbackDay(card.day, empty, MIN_BOARD_EVENTS);
    if (fallback) {
      range = nzServiceDayRange(fallback);
      data = await fetch(range);
    }
    const date = nzServiceDayString(range.start);
    when = serviceDayLabel(date);
    complete = date < today;
  } else {
    const period = await resolvePeriod(card.window, card.period);
    data = await fetch(period.range);
    when = period.when;
    complete = period.complete;
  }

  const eyebrow = eyebrowOf(
    isRoutes ? "Routes" : "Cancellations",
    when,
    cardFilterLabel(card.mode, card.includeSchool),
  );
  if (isRoutes) {
    const s = data.routes;
    return {
      eyebrow,
      body: {
        route: null,
        name: null,
        subname: null,
        hero:
          data.count > 0
            ? { text: `${data.count.toLocaleString("en-NZ")} routes`, toneClass: "text-at-ink" }
            : null,
        lines:
          s && s.on_time_pct != null
            ? [
                `ran ${arrivals(s.events)}, ${s.on_time_pct.toFixed(1)}% on time`,
                s.avg_abs_delay_sec == null
                  ? ""
                  : `${formatDuration(s.avg_abs_delay_sec)} off schedule on average`,
              ].filter(Boolean)
            : [],
      },
      complete,
    };
  }

  const { trips } = data;
  const byRoute = new Map<string, { name: string; n: number }>();
  for (const t of trips) {
    const row = byRoute.get(t.route_id);
    if (row) row.n++;
    else byRoute.set(t.route_id, { name: t.short_name ?? t.route_id, n: 1 });
  }
  const top = [...byRoute.values()].sort((a, b) => b.n - a.n)[0];
  const neverRan = trips.filter((t) => t.stage === "before").length;
  const cutShort = trips.filter((t) => t.stage === "mid-trip").length;
  return {
    eyebrow,
    body: {
      route: null,
      name: null,
      subname: null,
      hero:
        trips.length > 0
          ? { text: trips.length.toLocaleString("en-NZ"), toneClass: "text-at-late" }
          : { text: "None", toneClass: "text-at-ontime" },
      lines:
        trips.length > 0
          ? [
              `trip${trips.length === 1 ? "" : "s"} flagged cancelled, reinstated ones included`,
              `${neverRan} never ran, ${cutShort} cut short`,
              top ? `Most on ${top.name}: ${top.n}` : "",
            ].filter(Boolean)
          : ["No trip was flagged cancelled"],
    },
    complete,
  };
}
