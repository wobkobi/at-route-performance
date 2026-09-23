// src/app/days/page.tsx
// Day by day: a week or month of the network's daily verdicts, as a column chart
// and a table of the same days, each linking to that day's overview. A day's
// figures come from the same per-day rankings and cancelled count the day view
// reads, through the same summary, so a column always says what `/?day=` does.

import { CHART_FLOOR, DayChart } from "@/components/DayChart";
import { DaysBodySkeleton } from "@/components/DaysSkeleton";
import { ModeFilter, type ModeFilterValue } from "@/components/ModeFilter";
import { RangeControls } from "@/components/RangeControls";
import { SchoolBusToggle } from "@/components/SchoolBusToggle";
import {
  getCancelledCount,
  getEarliestDataDay,
  getLatestEventDate,
  getRankings,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { DATA_START_DAY } from "@/lib/data-start";
import { daySlot, type DaySlot } from "@/lib/day-series";
import { formatDuration, UNKNOWN_VALUE } from "@/lib/format";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import {
  parseRangeWindow,
  periodForCarriedDay,
  periodRangeNav,
  type RangeWindow,
} from "@/lib/range-page";
import {
  nzServiceDayRange,
  nzServiceDayString,
  serviceDatesInRange,
  serviceDayLabel,
  type DateRange,
} from "@/lib/time";
import { buildHref } from "@/lib/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type JSX } from "react";

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
}

/**
 * Day by day page.
 * @param root0 - Page props.
 * @param root0.searchParams - Window (`window`, `period`, `day`) and filter (`mode`, `school`) params.
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
  const mode = (
    ["BUS", "TRAIN", "FERRY"].includes(sp.mode ?? "") ? sp.mode : null
  ) as ModeFilterValue;
  const includeSchool = sp.school === "1";
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
        period: periodForCarriedDay("week", sp.period, sp.day),
        mode: mode ?? undefined,
        school: includeSchool ? "1" : undefined,
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
    periodForCarriedDay(window, sp.period, sp.day),
    latest ?? new Date(),
    earliest,
  );
  const view = { window, period: period ?? undefined };
  const filters = { mode: mode ?? undefined, school: includeSchool ? "1" : undefined };
  const modePreserved = stripUnset({ ...view, school: filters.school });
  const schoolPreserved = stripUnset({ ...view, mode: filters.mode });

  return (
    <main className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">Day by day</h1>
        <RangeControls basePath="/days" nav={nav} windows={WINDOWS} />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <ModeFilter active={mode} basePath="/days" preservedParams={modePreserved} />
        <SchoolBusToggle
          active={includeSchool}
          basePath="/days"
          preservedParams={schoolPreserved}
        />
        <Link
          href={buildHref("/", { ...view, ...filters })}
          className="ml-auto text-sm font-semibold text-at-shore hover:underline"
        >
          {window === "week" ? "The week's overview" : "The month's overview"}
        </Link>
      </div>

      <Suspense fallback={<DaysBodySkeleton window={window} />}>
        <DaysBody
          range={range}
          monthView={window === "month"}
          mode={mode}
          includeSchool={includeSchool}
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
 * The chart and the table, streamed behind the header: a month is up to ~30
 * per-day reads, each cached per day, so a cold one is the part worth waiting on.
 * @param root0 - Props.
 * @param root0.range - The window.
 * @param root0.monthView - Whether the window is a month.
 * @param root0.mode - Active mode filter, or null for every mode.
 * @param root0.includeSchool - Whether school services count.
 * @returns The chart and table.
 */
async function DaysBody({
  range,
  monthView,
  mode,
  includeSchool,
}: {
  range: DateRange;
  monthView: boolean;
  mode: ModeFilterValue;
  includeSchool: boolean;
}): Promise<JSX.Element> {
  const today = nzServiceDayString();
  // A month that starts before capture began leaves those days off entirely,
  // rather than drawing them as gaps; the stepper label already says "from".
  const dates = serviceDatesInRange(range).filter((d) => d >= DATA_START_DAY);
  const slots: DaySlot[] = await Promise.all(
    dates.map(async (date) => {
      if (date > today) return daySlot(date, today, null, { mode, includeSchool });
      // The day view's own range and keys, so these reads share its cache.
      const dayRange = nzServiceDayRange(date);
      const [rows, cancelled] = await Promise.all([
        getRankings(dayRange, ON_TIME_LATE_SEC, TODAY_REVALIDATE),
        getCancelledCount(dayRange, { mode, includeSchool }, TODAY_REVALIDATE),
      ]);
      return daySlot(date, today, { rows, cancelled }, { mode, includeSchool });
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
      school: includeSchool ? "1" : undefined,
    });
  // Narrowed, not just filtered, so the table's rows can read an empty day's
  // cancellation count without a second check for a variant it never holds.
  const past = slots.filter((s): s is Exclude<DaySlot, { kind: "future" }> => s.kind !== "future");

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
              <th scope="col" className="p-3 font-semibold">
                Day
              </th>
              <th scope="col" className="p-3 font-semibold">
                Verdict
              </th>
              <th scope="col" className="p-3 text-right font-semibold">
                On time
              </th>
              <th scope="col" className="p-3 text-right font-semibold">
                Off by
              </th>
              <th scope="col" className="hidden p-3 text-right font-semibold sm:table-cell">
                Arrivals
              </th>
              <th scope="col" className="hidden p-3 text-right font-semibold sm:table-cell">
                Flagged cancelled
              </th>
            </tr>
          </thead>
          <tbody>
            {past.map((s) => (
              <tr key={s.date} className="border-b border-at-border last:border-b-0">
                <th scope="row" className="p-3 text-left font-semibold whitespace-nowrap">
                  <Link href={hrefFor(s.date)} className="text-at-shore hover:underline">
                    {serviceDayLabel(s.date)}
                  </Link>
                  {s.date === today && (
                    <span className="ml-1 font-normal text-at-muted">so far</span>
                  )}
                </th>
                {s.kind === "day" ? (
                  <>
                    <td className={`p-3 font-semibold ${s.verdict?.toneClass ?? "text-at-muted"}`}>
                      {s.verdict?.label ?? UNKNOWN_VALUE}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {s.summary.on_time_pct === null
                        ? UNKNOWN_VALUE
                        : `${s.summary.on_time_pct.toFixed(1)}%`}
                    </td>
                    <td className="p-3 text-right tabular-nums">
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
                  <td colSpan={5} className="p-3 text-at-muted">
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
