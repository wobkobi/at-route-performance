// src/app/days/page.tsx
// Day by day: a week or month of the network's daily verdicts, as a column chart
// and a table of the same days, each linking to that day's overview. A day's
// figures come from the same per-day rankings and cancelled count the day view
// reads, through the same summary, so a column always says what `/?day=` does.

import { RangeControls } from "@/components/date/RangeControls";
import { CHART_FLOOR, DayChart } from "@/components/DayChart";
import { ModeFilter } from "@/components/filter/ModeFilter";
import { SchoolBusToggle } from "@/components/filter/SchoolBusToggle";
import { LoadingBlock } from "@/components/Loading";
import { SortHeader } from "@/components/SortHeader";
import {
  getCancelledCount,
  getEarliestDataDay,
  getLatestEventDate,
  getRankings,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { formatDuration, UNKNOWN_VALUE } from "@/lib/format";
import { parseMode, type Mode } from "@/lib/mode";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import {
  parseRangeWindow,
  periodForCarriedDay,
  periodRangeNav,
  type RangeWindow,
} from "@/lib/page/range";
import {
  sortRows,
  tableSort,
  type SortColumn,
  type SortDir,
  type TableSort,
} from "@/lib/page/table-sort";
import { parseSchoolFilter, schoolFilterParam, type SchoolFilter } from "@/lib/school-bus";
import { DATA_START_DAY } from "@/lib/time/data-start";
import { daySlot, type DaySlot } from "@/lib/time/day-series";
import { requestServiceDay } from "@/lib/time/request-now";
import { nzServiceDayRange, serviceDatesInRange, serviceDayLabel } from "@/lib/time/service-day";
import { buildHref } from "@/lib/utils";
import type { TopRouteRow } from "@/types/api";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type JSX } from "react";

// Not yet converted to a prerendered shell: this segment still reads its
// search params and its data above any Suspense boundary, so it is allowed to
// block. Removing this line is what converts the route.
export const instant = false;

export const metadata: Metadata = {
  title: "Day by day",
  description:
    "How each day of the week or month went on Auckland's buses, trains and ferries, one verdict per day.",
};

/** One day is one column, so the page offers no Day tab. */
const WINDOWS: readonly RangeWindow[] = ["week", "month"];

/** Query params for the Day by day page. */
interface DaysSearchParams {
  window?: string;
  period?: string;
  day?: string;
  mode?: string;
  school?: string;
  /** The table's sorted column; absent is newest first. */
  sort?: string;
  /** "1" sorts the column the other way. */
  rev?: string;
}

/** One past day as the table sorts it; the figures are null on a day with no arrivals. */
interface DayLine {
  slot: Exclude<DaySlot, { kind: "future" }>;
  date: string;
  onTime: number | null;
  offSec: number | null;
  arrivals: number | null;
  cancelled: number;
}

const COLUMNS: SortColumn<DayLine>[] = [
  { key: "day", value: "date" },
  { key: "ontime", value: "onTime" },
  { key: "off", value: "offSec" },
  { key: "arrivals", value: "arrivals" },
  { key: "cancelled", value: "cancelled" },
];

/**
 * Day by day page.
 * @param root0 - Page props.
 * @param root0.searchParams - Window (`window`, `period`, `day`), filter (`mode`, `school`) and
 *   sort (`sort`, `rev`) params.
 * @returns Page markup.
 */
export default async function DaysPage({
  searchParams,
}: {
  searchParams?: Promise<DaysSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  // An explicit window is read the way every range page reads it, so this page
  // cannot disagree with the rest about what a value means; only an absent one
  // takes the week default, as `/rankings` does. A bare `/days` stays bare rather
  // than redirecting to `?window=week`: it is the URL the sitemap advertises, and
  // robots.txt disallows every query string, so the redirect would send a crawler
  // from the canonical page to one it may not fetch.
  const requested = sp.window ? parseRangeWindow(sp.window) : "week";
  const mode = parseMode(sp.mode);
  const schools = parseSchoolFilter(sp.school);
  // One request-time clock read for the whole render, handed to every helper that
  // places a day against today (see lib/time/request-now.ts). Resolved before the
  // redirect below, which needs it to place a carried day in its week.
  const today = await requestServiceDay();
  // One day is one column here, so there is no day view to honour and a
  // `?window=day` would render a week under a URL saying otherwise. It becomes the
  // week holding the day it was reading, before any read runs. The segment's
  // loading shell has already flushed by the time a page component runs, so Next
  // lands this as a client navigation rather than a status code - the same way the
  // home page drops a `?day=<today>`.
  if (requested === "day") {
    redirect(
      buildHref("/days", {
        window: "week",
        period: periodForCarriedDay("week", sp.period, sp.day, today),
        mode: mode ?? undefined,
        school: schoolFilterParam(schools),
      }),
    );
  }
  const window = requested;
  // Anchored on the latest day with data, as the home week and month are, so the
  // two name the same period.
  const [latest, earliest] = await Promise.all([getLatestEventDate(), getEarliestDataDay(1)]);
  const { range, period, nav } = periodRangeNav(
    "/days",
    window,
    // The nav and the footer carry the day being read, so the week or month shown
    // is the one holding it rather than the current one.
    periodForCarriedDay(window, sp.period, sp.day, today),
    latest ?? new Date(),
    earliest,
    today,
  );
  const view = { window, period: period ?? undefined };
  const filters = { mode: mode ?? undefined, school: schoolFilterParam(schools) };
  const { sort, head, keep } = tableSort(sp, COLUMNS, "day", (p) =>
    buildHref("/days", { ...view, ...filters, ...p }),
  );
  const modePreserved = stripUnset({ ...view, school: filters.school, ...keep });
  const schoolPreserved = stripUnset({ ...view, mode: filters.mode, ...keep });
  // Each day's routes, read once and shared: the filters need them to know which
  // modes ran and whether a school service did, and the chart and table below
  // need them for the figures. A month that starts before capture began leaves
  // those days off entirely rather than drawing them as gaps.
  const dates = serviceDatesInRange(range).filter((d) => d >= DATA_START_DAY);
  const dayRows = Promise.all(
    dates.map((date) =>
      date > today
        ? Promise.resolve(null)
        : getRankings(nzServiceDayRange(date), ON_TIME_LATE_SEC, TODAY_REVALIDATE),
    ),
  );
  // Both readers await it later, in stream order; this keeps an early rejection
  // from being reported as unhandled before the first of them gets there.
  dayRows.catch(() => undefined);

  return (
    <main className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">Day by day</h1>
        <RangeControls basePath="/days" nav={nav} windows={WINDOWS} />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Suspense
          fallback={<ModeFilter active={mode} basePath="/days" preservedParams={modePreserved} />}
        >
          <DaysFilters
            dayRows={dayRows}
            mode={mode}
            schools={schools}
            modePreserved={modePreserved}
            schoolPreserved={schoolPreserved}
          />
        </Suspense>
        <Link
          href={buildHref("/", { ...view, ...filters })}
          className="ml-auto text-sm font-semibold text-at-shore hover:underline"
        >
          {window === "week" ? "The week's overview" : "The month's overview"}
        </Link>
      </div>

      <Suspense fallback={<LoadingBlock label="Loading the days" />}>
        <DaysBody
          dates={dates}
          dayRows={dayRows}
          monthView={window === "month"}
          mode={mode}
          schools={schools}
          today={today}
          sort={sort}
          head={head}
        />
      </Suspense>
    </main>
  );
}

/**
 * Drop the unset entries from a param set, for a control's preserved params.
 * @param params - The params, some unset.
 * @returns The set ones.
 */
function stripUnset(params: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined),
  );
}

/**
 * The Mode and School buses boxes, once the days' routes say what ran: a mode
 * with no route in the window is left out, and the school box only shows when a
 * school service ran under the mode chosen.
 * @param root0 - Props.
 * @param root0.dayRows - Each day's routes, null for a day not yet started.
 * @param root0.mode - Active mode filter, or null for every mode.
 * @param root0.schools - Which school services count.
 * @param root0.modePreserved - Params the Mode box keeps.
 * @param root0.schoolPreserved - Params the School buses box keeps.
 * @returns The boxes that would change something.
 */
async function DaysFilters({
  dayRows,
  mode,
  schools,
  modePreserved,
  schoolPreserved,
}: {
  dayRows: Promise<(TopRouteRow[] | null)[]>;
  mode: Mode | null;
  schools: SchoolFilter;
  modePreserved: Record<string, string>;
  schoolPreserved: Record<string, string>;
}): Promise<JSX.Element> {
  const rows = (await dayRows).flatMap((r) => r ?? []);
  return (
    <>
      <ModeFilter
        active={mode}
        basePath="/days"
        preservedParams={modePreserved}
        availableModes={new Set(rows.map((r) => r.mode))}
      />
      <SchoolBusToggle value={schools} basePath="/days" preservedParams={schoolPreserved} />
    </>
  );
}

/**
 * The chart and the table, streamed behind the header: a month is up to ~30
 * per-day reads, each cached per day, so a cold one is the part worth waiting on.
 * @param root0 - Props.
 * @param root0.dates - The window's service dates from the start of capture.
 * @param root0.dayRows - Each date's routes, in the same order, null for a day not yet started.
 * @param root0.monthView - Whether the window is a month.
 * @param root0.mode - Active mode filter, or null for every mode.
 * @param root0.schools - Which school services count.
 * @param root0.today - Today's service date, resolved once by the page.
 * @param root0.sort - The table's sort.
 * @param root0.head - Each column heading's link and direction.
 * @returns The chart and table.
 */
async function DaysBody({
  dates,
  dayRows,
  monthView,
  mode,
  schools,
  today,
  sort,
  head,
}: {
  dates: string[];
  dayRows: Promise<(TopRouteRow[] | null)[]>;
  monthView: boolean;
  mode: Mode | null;
  schools: SchoolFilter;
  today: string;
  sort: TableSort | null;
  head: (key: string) => { href: string; dir: SortDir | null };
}): Promise<JSX.Element> {
  const allRows = await dayRows;
  const slots: DaySlot[] = await Promise.all(
    dates.map(async (date, i) => {
      const rows = allRows[i];
      if (!rows) return daySlot(date, today, null, { mode, schools });
      // The day view's own range and keys, so these reads share its cache.
      const cancelled = await getCancelledCount(
        nzServiceDayRange(date),
        { mode, schools },
        TODAY_REVALIDATE,
      );
      return daySlot(date, today, { rows, cancelled }, { mode, schools });
    }),
  );

  /**
   * A day's overview, carrying the filters. Today's link drops `?day`, which the
   * home page would otherwise redirect away.
   * @param date - The service date.
   * @returns The href.
   */
  const hrefFor = (date: string): string =>
    buildHref("/", {
      day: date === today ? undefined : date,
      mode: mode ?? undefined,
      school: schoolFilterParam(schools),
    });
  // Narrowed, not just filtered, so the table's rows can read an empty day's
  // cancellation count without a second check for a variant it never holds.
  // Newest first unless a heading re-sorts it, so today or the latest day tops
  // the table; the chart above still reads left to right in time.
  const past = sortRows(
    slots
      .filter((s): s is Exclude<DaySlot, { kind: "future" }> => s.kind !== "future")
      .map((slot): DayLine =>
        slot.kind === "day"
          ? {
              slot,
              date: slot.date,
              onTime: slot.summary.on_time_pct,
              offSec: slot.summary.avg_abs_delay_sec,
              arrivals: slot.summary.events,
              cancelled: slot.summary.cancelled ?? 0,
            }
          : {
              slot,
              date: slot.date,
              onTime: null,
              offSec: null,
              arrivals: null,
              cancelled: slot.cancelled,
            },
      ),
    COLUMNS,
    sort,
  ).map((l) => l.slot);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <DayChart slots={slots} today={today} hrefFor={hrefFor} monthView={monthView} />
        <p className="text-xs text-at-muted">
          Column height is the day&apos;s on-time share, from {CHART_FLOOR}% up; the dashed lines
          are where each verdict starts. A dashed mark on the floor is a day with no arrivals
          recorded, and today&apos;s paler column is still filling.
        </p>
      </div>

      <div className="overflow-x-auto border border-at-border bg-at-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-at-border text-left text-xs tracking-wide text-at-muted uppercase">
              <SortHeader {...head("day")} align="left" className="px-2 py-3 sm:p-3">
                Day
              </SortHeader>
              {/* Not sortable: the verdict is banded from On time, which sorts. */}
              <SortHeader align="left" className="px-2 py-3 sm:p-3">
                Verdict
              </SortHeader>
              <SortHeader {...head("ontime")} className="px-2 py-3 sm:p-3">
                On time
              </SortHeader>
              <SortHeader {...head("off")} className="px-2 py-3 sm:p-3">
                Off by
              </SortHeader>
              <SortHeader {...head("arrivals")} className="hidden sm:table-cell">
                Arrivals
              </SortHeader>
              <SortHeader {...head("cancelled")} className="hidden sm:table-cell">
                Flagged cancelled
              </SortHeader>
            </tr>
          </thead>
          <tbody>
            {past.map((s) => (
              <tr key={s.date} className="border-b border-at-border last:border-b-0">
                <th
                  scope="row"
                  className="px-2 py-3 text-left font-semibold whitespace-nowrap sm:p-3"
                >
                  <Link href={hrefFor(s.date)} className="text-at-shore hover:underline">
                    {serviceDayLabel(s.date)}
                  </Link>
                  {s.date === today && (
                    <span className="ml-1 font-normal text-at-muted">so far</span>
                  )}
                </th>
                {s.kind === "day" ? (
                  <>
                    <td
                      className={`px-2 py-3 font-semibold sm:p-3 ${s.verdict?.toneClass ?? "text-at-muted"}`}
                    >
                      {s.verdict?.label ?? UNKNOWN_VALUE}
                    </td>
                    <td className="px-2 py-3 text-right whitespace-nowrap tabular-nums sm:p-3">
                      {s.summary.on_time_pct === null
                        ? UNKNOWN_VALUE
                        : `${s.summary.on_time_pct.toFixed(1)}%`}
                    </td>
                    <td className="px-2 py-3 text-right whitespace-nowrap tabular-nums sm:p-3">
                      {s.summary.avg_abs_delay_sec === null
                        ? UNKNOWN_VALUE
                        : formatDuration(s.summary.avg_abs_delay_sec)}
                    </td>
                    <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                      {s.summary.events.toLocaleString()}
                    </td>
                    <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                      {(s.summary.cancelled ?? 0).toLocaleString()}
                    </td>
                  </>
                ) : (
                  <td colSpan={5} className="px-2 py-3 text-at-muted sm:p-3">
                    No arrivals recorded
                    {/* The cancellations are the only thing that separates the
                        worst possible day - every trip cancelled, so nothing
                        arrived - from an ingest outage. Named here rather than
                        in the column beside it, which a phone does not render. */}
                    {s.cancelled > 0 &&
                      `, and ${s.cancelled.toLocaleString()} trip${s.cancelled === 1 ? "" : "s"} flagged cancelled`}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
