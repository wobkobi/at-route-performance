// src/app/compare/page.tsx
// Compare: up to four routes, or up to four stops, side by side over a day,
// week or month. Routes are read off the same per-route rows the Routes page
// uses, so a route comparison adds no query of its own; stops each take the
// stop page's own summary. The picker is a plain GET form, so adding and
// removing works as links and survives a reload or a shared URL.

import { ChipGroup, ChipLink } from "@/components/Chip";
import { CompareSearch } from "@/components/compare/CompareSearch";
import { RangeControls } from "@/components/date/RangeControls";
import { ModeIcon } from "@/components/ModeIcon";
import { Badge } from "@/components/ui/Badge";
import { DataTable, ROW_CLASS } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import {
  bestColumns,
  COMPARE_SEARCH_LIMIT,
  MAX_COMPARE,
  parseCompareIds,
  parseCompareKind,
  stopCandidate,
  toggleCompareId,
  type CompareCandidate,
  type CompareKind,
} from "@/lib/compare";
import {
  getBusiestRouteSlugs,
  getCancelledByRoute,
  getEarliestDataDay,
  getLatestEventDate,
  getRankings,
  getStopStats,
  revalidateFor,
  searchStops,
} from "@/lib/data";
import { formatCount, formatDuration, formatPct, UNKNOWN_VALUE } from "@/lib/format";
import { pageMetadata } from "@/lib/og";
import { routeHref, stopHref } from "@/lib/page/hrefs";
import { resolveRequestedDay, resolveShownDay } from "@/lib/page/nav";
import {
  dayRangeNav,
  parseRangeWindow,
  periodRangeNav,
  rangeViewParams,
  routeLinkParams,
  windowPhrase,
  type RangeNav,
} from "@/lib/page/range";
import { routeDisplayName, routeSlug, routeSubtitle } from "@/lib/route/slug";
import { clampDayParam, dayLinkParam, dropTodayParam } from "@/lib/time/day-url";
import { requestServiceDay } from "@/lib/time/request-now";
import type { DateRange } from "@/lib/time/service-day";
import { buildHref } from "@/lib/utils";
import type { RouteRow } from "@/types/api";
import type { Metadata } from "next";
import Link from "next/link";
import type { JSX } from "react";

// Reads its search params and its data above any Suspense boundary, like the
// Operators page, so it is allowed to block.
export const instant = false;

export const metadata: Metadata = pageMetadata({
  title: "Compare",
  description:
    "Line up Auckland routes or stops side by side: on time, early, late, average off schedule and cancellations.",
});

/** Query params for the compare page. */
interface CompareSearchParams {
  kind?: string;
  ids?: string;
  q?: string;
  window?: string;
  day?: string;
  period?: string;
}

/** The figures a column shows, whichever kind it is. */
interface CompareFigures {
  events: number;
  on_time_pct: number | null;
  early_pct: number | null;
  late_pct: number | null;
  avg_abs_delay_sec: number | null;
}

/** One column: a route or a stop and its figures for the window. */
interface CompareColumn {
  id: string;
  name: string;
  /** A second line under the name: a route's long name, a stop's code. */
  detail: string | null;
  href: string;
  /** The route's badge, for a route column. */
  route: Pick<RouteRow, "mode" | "shortName" | "longName" | "colour"> | null;
  /** Null when nothing was recorded in the window. */
  figures: CompareFigures | null;
  /** Cancelled trips (routes) or routes calling (stops). */
  extra: number | null;
}

/**
 * A route as a picker candidate: its name, its line or long name, its badge and
 * its on-time share.
 * @param r - The route row.
 * @returns The candidate.
 */
function routeCandidate(r: RouteRow): CompareCandidate {
  return {
    id: routeSlug(r.routeId),
    name: routeDisplayName(r),
    detail: routeSubtitle(r),
    route: r,
    onTimePct: r.on_time_pct,
  };
}

/** A figure a column can show. */
type FigureKey = keyof CompareFigures | "extra";

/** One row of the comparison table. */
interface FigureRow {
  label: string;
  key: FigureKey;
  format: "pct" | "duration" | "count";
  /** Which way wins, or null for a count, where more is not better or worse. */
  better: "high" | "low" | null;
}

/**
 * The rows of the table for a kind. Shares and the average are marked best
 * where one column wins; counts are not, since a busier route is not better.
 * @param kind - Routes or stops.
 * @returns The rows, top to bottom.
 */
function figureRows(kind: CompareKind): FigureRow[] {
  return [
    { label: "On time", key: "on_time_pct", format: "pct", better: "high" },
    { label: "Late", key: "late_pct", format: "pct", better: "low" },
    { label: "Early", key: "early_pct", format: "pct", better: "low" },
    { label: "Avg off by", key: "avg_abs_delay_sec", format: "duration", better: "low" },
    { label: "Arrivals", key: "events", format: "count", better: null },
    {
      label: kind === "routes" ? "Cancelled trips" : "Routes calling",
      key: "extra",
      format: "count",
      better: null,
    },
  ];
}

/**
 * One column's value for a row.
 * @param c - The column.
 * @param key - The figure.
 * @returns The value, or null when unknown.
 */
function figureOf(c: CompareColumn, key: FigureKey): number | null {
  return key === "extra" ? c.extra : (c.figures?.[key] ?? null);
}

/**
 * A value as the table prints it.
 * @param v - The value.
 * @param format - How the row reads.
 * @returns The printed value.
 */
function formatFigure(v: number, format: FigureRow["format"]): string {
  if (format === "pct") return formatPct(v);
  if (format === "duration") return formatDuration(v);
  return formatCount(v);
}

/**
 * The share bar under a column's name: on time, late and early, in the colours
 * every split on the site uses.
 * @param props - Component props.
 * @param props.figures - The column's figures.
 * @returns The bar, or nothing without a split.
 */
function MiniSplit({ figures }: { figures: CompareFigures | null }): JSX.Element | null {
  if (
    !figures ||
    figures.on_time_pct === null ||
    figures.late_pct === null ||
    figures.early_pct === null
  ) {
    return null;
  }
  return (
    <div className="mt-2 flex h-1.5 w-full overflow-hidden bg-at-bg" aria-hidden>
      <div className="bg-at-ontime" style={{ width: `${figures.on_time_pct}%` }} />
      <div className="bg-at-late" style={{ width: `${figures.late_pct}%` }} />
      <div className="bg-at-early" style={{ width: `${figures.early_pct}%` }} />
    </div>
  );
}

/**
 * Compare page.
 * @param root0 - Page props.
 * @param root0.searchParams - What to compare (`kind`, `ids`), the picker's `q`,
 *   and the window (`window`, `day`, `period`).
 * @returns Page markup.
 */
export default async function ComparePage({
  searchParams,
}: {
  searchParams?: Promise<CompareSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const kind = parseCompareKind(sp.kind);
  const ids = parseCompareIds(sp.ids);
  const q = (sp.q ?? "").trim();
  const window = parseRangeWindow(sp.window);
  // One request-time clock read for the whole render, taken before the day-param
  // redirects so none of them reads the clock during the static prerender.
  const today = await requestServiceDay();
  if (window === "day") {
    clampDayParam("/compare", sp, today);
    dropTodayParam("/compare", sp, today);
  }
  const [latest, earliest] = await Promise.all([getLatestEventDate(), getEarliestDataDay(1)]);

  let range: DateRange;
  let nav: RangeNav;
  let serviceDate: string | null = null;
  let linkDay: string | undefined;
  let period: string | null = null;
  if (window === "day") {
    const day = await resolveShownDay(resolveRequestedDay(sp.day), today);
    range = day.range;
    nav = dayRangeNav(day, earliest, today);
    serviceDate = day.serviceDate;
    linkDay = dayLinkParam(day.serviceDate, today);
  } else {
    ({ range, period, nav } = periodRangeNav(
      "/compare",
      window,
      sp.period,
      latest ?? new Date(),
      earliest,
      today,
    ));
  }
  const revalidate = revalidateFor(window);
  const view = rangeViewParams(window, linkDay, period);
  const phrase = windowPhrase(nav, period);

  let columns: CompareColumn[] = [];
  let missing: string[] = [];
  let routeOptions: CompareCandidate[] = [];
  let stopMatches: CompareCandidate[] = [];
  let suggestions: CompareCandidate[] = [];

  if (kind === "routes") {
    const [rows, cancelled, busiest] = await Promise.all([
      getRankings(range, revalidate),
      getCancelledByRoute(range, { mode: null, schools: "include" }, revalidate),
      ids.length < MAX_COMPARE ? getBusiestRouteSlugs(12) : Promise.resolve([]),
    ]);
    const bySlug = new Map(rows.map((r) => [routeSlug(r.routeId).toLowerCase(), r]));
    const routeParams = routeLinkParams(window, serviceDate, period, today);
    for (const id of ids) {
      const r = bySlug.get(id.toLowerCase());
      if (!r) {
        missing.push(id);
        continue;
      }
      const slug = routeSlug(r.routeId);
      columns.push({
        id,
        name: routeDisplayName(r),
        detail: routeSubtitle(r),
        href: routeHref(slug, routeParams),
        route: r,
        figures: {
          events: r.events,
          on_time_pct: r.on_time_pct,
          early_pct: r.early_pct ?? null,
          late_pct: r.late_pct ?? null,
          avg_abs_delay_sec: r.avg_abs_delay_sec,
        },
        extra: cancelled.get(slug) ?? 0,
      });
    }
    const chosen = new Set(ids.map((i) => i.toLowerCase()));
    // The picker filters these as you type, so they go to it busiest first.
    routeOptions =
      ids.length < MAX_COMPARE
        ? [...rows].sort((a, b) => b.events - a.events).map(routeCandidate)
        : [];
    suggestions = busiest
      .filter((s) => !chosen.has(s.toLowerCase()))
      .flatMap((s) => {
        const r = bySlug.get(s.toLowerCase());
        return r ? [{ ...routeCandidate(r), id: s }] : [];
      })
      .slice(0, 6);
  } else {
    const [stats, found] = await Promise.all([
      Promise.all(ids.map((id) => getStopStats(id, range, revalidate))),
      q ? searchStops(q, COMPARE_SEARCH_LIMIT + MAX_COMPARE) : Promise.resolve([]),
    ]);
    // The stop page has a day view only, so a week or month links to today.
    const stopDay = window === "day" ? view.day : undefined;
    stats.forEach((s, i) => {
      const id = ids[i]!;
      if (!s) {
        missing.push(id);
        return;
      }
      columns.push({
        id,
        name: s.stop.name,
        detail: null,
        href: stopHref(id, { day: stopDay }),
        route: null,
        figures: s.summary,
        extra: s.routes_count,
      });
    });
    stopMatches = found.map(stopCandidate);
  }
  columns = columns.slice(0, MAX_COMPARE);
  missing = missing.filter(Boolean);

  /**
   * This page with a new set of ids, on the same window and kind.
   * @param next - The new `ids` value, or null for none.
   * @param keepQ - Keep the search, so several results can be added in turn.
   * @returns The href.
   */
  const idsHref = (next: string | null, keepQ = false): string =>
    buildHref("/compare", { ...view, kind, ids: next, q: keepQ ? q || undefined : undefined });
  const full = ids.length >= MAX_COMPARE;
  const rows = figureRows(kind);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Compare"
        subtitle={`Up to ${MAX_COMPARE} ${kind} side by side, ${phrase}.`}
        actions={<RangeControls basePath="/compare" nav={nav} />}
      />

      <ChipGroup label="What to compare">
        {(["routes", "stops"] as const).map((k) => (
          <ChipLink key={k} href={buildHref("/compare", { ...view, kind: k })} active={kind === k}>
            {k === "routes" ? "Routes" : "Stops"}
          </ChipLink>
        ))}
      </ChipGroup>

      {columns.length > 0 && (
        <DataTable caption={`The ${kind} side by side`} tableClassName="w-full table-fixed">
          <colgroup>
            <col className="w-24 sm:w-32" />
            {columns.map((c) => (
              <col key={c.id} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-at-border align-top">
              <th scope="col" className="p-2 text-left sm:p-3">
                <span className="sr-only">Figure</span>
              </th>
              {columns.map((c) => (
                <th key={c.id} scope="col" className="p-2 text-left font-normal sm:p-3">
                  <Link href={c.href} className="block min-w-0 hover:underline">
                    <span className="flex items-start gap-1.5 font-semibold text-at-shore">
                      {c.route && (
                        <ModeIcon
                          mode={c.route.mode}
                          shortName={c.route.shortName}
                          longName={c.route.longName}
                          colour={c.route.colour}
                          className="mt-0.5 h-4 w-4 shrink-0"
                        />
                      )}
                      <span className="min-w-0 wrap-break-word">{c.name}</span>
                    </span>
                    {c.detail && (
                      <span className="mt-0.5 line-clamp-2 block text-xs text-at-muted">
                        {c.detail}
                      </span>
                    )}
                  </Link>
                  <MiniSplit figures={c.figures} />
                  <Link
                    href={idsHref(toggleCompareId(ids, c.id), true)}
                    scroll={false}
                    aria-label={`Remove ${c.name}`}
                    className="mt-2 inline-block text-xs text-at-muted hover:text-at-shore hover:underline"
                  >
                    × Remove
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const values = columns.map((c) => figureOf(c, row.key));
              const best = row.better ? bestColumns(values, row.better) : new Set<number>();
              return (
                <tr key={row.label} className={ROW_CLASS}>
                  <th scope="row" className="at-eyebrow p-2 text-left text-at-muted sm:p-3">
                    {row.label}
                  </th>
                  {values.map((v, i) => (
                    <td
                      key={columns[i]!.id}
                      className={cn(
                        "p-2 tabular-nums sm:p-3",
                        best.has(i) && "font-semibold text-at-ontime",
                      )}
                    >
                      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        {v === null ? UNKNOWN_VALUE : formatFigure(v, row.format)}
                        {best.has(i) && <Badge tone="ok" label="BEST" />}
                      </span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}

      {missing.length > 0 && (
        <EmptyState inset>
          No arrivals recorded {phrase} for {missing.join(", ")}.{" "}
          <Link
            href={idsHref(ids.filter((i) => !missing.includes(i)).join(",") || null)}
            className="at-link font-semibold"
          >
            Take {missing.length === 1 ? "it" : "them"} out
          </Link>
        </EmptyState>
      )}

      <Panel
        aria-label={`Add ${kind === "routes" ? "a route" : "a stop"}`}
        pad="sm"
        className="space-y-3"
      >
        {full ? (
          <p className="text-sm text-at-muted">
            That is {MAX_COMPARE}, the most one comparison holds. Remove one to add another.
          </p>
        ) : (
          <CompareSearch
            key={ids.join(",")}
            kind={kind}
            ids={ids}
            view={view}
            q={q}
            routes={routeOptions}
            stopMatches={stopMatches}
            suggestions={suggestions}
            phrase={phrase}
          />
        )}
        {ids.length > 0 && (
          <Link href={idsHref(null)} className="at-link inline-block text-sm font-semibold">
            Start again
          </Link>
        )}
      </Panel>

      <p className="text-xs text-at-muted">
        {kind === "routes"
          ? "A route's on-time share counts each cancelled trip as the wait for the next one, as on the route's own page. "
          : "A stop's figures cover every route calling there, and a station's cover all its platforms. "}
        The best share or average in each row is marked BEST.
      </p>
    </main>
  );
}
