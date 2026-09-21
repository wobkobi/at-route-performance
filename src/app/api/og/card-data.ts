// src/app/api/og/card-data.ts
// What each card shows, resolved the way its page resolves it: the same
// queries, the same thresholds and the same early-morning fallback to the
// latest full day, so a card never prints a figure its page would not.

import { CANCELLATION_BADGE_MEANING, cancellationStage } from "@/lib/cancellation";
import {
  findCanonicalRouteSlug,
  findSuccessorRouteSlug,
  getEarliestDataDay,
  getLatestEventDate,
  getLatestTripDay,
  getRankings,
  getRouteDailyStats,
  getRouteStats,
  getStopStats,
  getTripCancellation,
  getTripScheduledStops,
  getTripTimeline,
  TODAY_REVALIDATE,
} from "@/lib/data";
import {
  formatDuration,
  formatGtfsTime,
  OFF_SCHEDULE_TONE_CLASS,
  offScheduleValue,
} from "@/lib/format";
import { lineName } from "@/lib/line-name";
import { monthLabel, type HomeCard, type RouteCard, type StopCard, type TripCard } from "@/lib/og";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { maybeFallbackDay } from "@/lib/page-nav";
import { periodRangeNav } from "@/lib/range-page";
import { MIN_BOARD_EVENTS, summariseRows, visibleRows } from "@/lib/rankings";
import { aggregateWeek } from "@/lib/route-week";
import {
  nzClockTime,
  nzMonthKey,
  nzServiceDayRange,
  nzServiceDayString,
  nzWeekRange,
  serviceDatesInRange,
  serviceDayLabel,
  weekRangeLabel,
} from "@/lib/time";
import { dayVerdict } from "@/lib/verdict";
import type { FleetSummary } from "@/types/dashboard";
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

/** What a route, run or stop card shows once its view is resolved. */
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
  const [latest, earliest] = await Promise.all([getLatestEventDate(), getEarliestDataDay(1)]);
  const anchor = latest ?? new Date();
  const { range } = periodRangeNav("/", card.window, card.period ?? undefined, anchor, earliest);
  const rows = await getRankings(range, ON_TIME_LATE_SEC, TODAY_REVALIDATE);
  // Name the days the figures cover: a week's dates up to today, not beyond.
  const dates = serviceDatesInRange(range);
  const shown = dates.filter((d) => d <= today);
  const first = shown[0] ?? dates[0] ?? today;
  const last = shown.at(-1) ?? today;
  return {
    when:
      card.window === "month"
        ? monthLabel(card.period ?? nzMonthKey(anchor))
        : `${serviceDayLabel(first)} to ${serviceDayLabel(last)}`,
    summary: summariseRows(visibleRows(rows, filter)),
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
