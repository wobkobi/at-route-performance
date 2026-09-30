// src/components/ranking/PeriodOverview.tsx
// The home page's week or month data: one ranking batch, loaded once and
// streamed into three places (the verdict strip, the shame cards and the rank
// boards), so the headings and filter chips between them render straight away.
// A cold month fans out to ~30 per-day aggregations, which is why none of it
// blocks the page shell.

import { ModeFilter } from "@/components/filter/ModeFilter";
import { FleetSummary } from "@/components/ranking/FleetSummary";
import { RankBoard } from "@/components/ranking/RankBoard";
import { WorstRouteCard } from "@/components/ranking/WorstRouteCard";
import { WorstStopCard } from "@/components/ranking/WorstStopCard";
import { ShameOfDay } from "@/components/shame/ShameOfDay";
import { ON_TIME_CAPTION, ON_TIME_SHARE_CAPTION } from "@/lib/copy";
import {
  getCancelledByRoute,
  getCancelledCount,
  getFilteredCancellations,
  getFilteredRankings,
  getShameOfWeek,
  getShameRouteOfWeek,
  getWorstStopsOfWeek,
} from "@/lib/data";
import { CANCELLED_SPLIT_COPY } from "@/lib/on-time";
import { routeLinkQuery } from "@/lib/page/range";
import { resolvePrevRange, type RankMode, type RankWindow } from "@/lib/page/rankings";
import { hasRankingFilters, type RankingFilters } from "@/lib/ranking-filters";
import {
  computeRankDelta,
  deriveBoards,
  deriveOffSchedule,
  MIN_BOARD_EVENTS,
  MIN_MODE_EVENTS,
  summariseRows,
  type DelayDirection,
} from "@/lib/rankings";
import { viewQuery } from "@/lib/route/explorer";
import {
  isSchoolBus,
  schoolAllows,
  schoolDelta,
  type SchoolDelta,
  type SchoolFilter,
} from "@/lib/school-bus";
import { rangeIsEmpty } from "@/lib/time/data-start";
import type { DateRange } from "@/lib/time/service-day";
import { buildHref } from "@/lib/utils";
import type { TopRouteRow } from "@/types/api";
import type {
  FleetSummary as FleetSummaryData,
  ShameOfWeek,
  ShameRouteOfWeek,
  ShameStopOfWeek,
} from "@/types/dashboard";
import type { JSX } from "react";

const REVALIDATE = 3600; // 1 hour
/** Routes each board shows; the full ranking is on the Routes page. */
const BOARD_SIZE = 10;

/** The view a period batch is loaded for. */
export interface PeriodView {
  window: RankWindow;
  mode: RankMode;
  dir: DelayDirection;
  schools: SchoolFilter;
  /** Raw `?period=` value, used for the previous range and row links. */
  period: string | undefined;
  range: DateRange;
  /** The latest day with data (or now). */
  anchor: Date;
  /** Time of day, day type and area, narrowing the rankings and the strip. */
  filters: RankingFilters;
}

/** Everything the ranking parts of the week or month home render from. */
export interface PeriodCore {
  heroData: FleetSummaryData;
  /** What including school services added to each count, or null while they are left out. */
  schoolAdded: SchoolDelta | null;
  /** Modes with at least one route over the board bar, for the mode chips. */
  availableModes: Set<string>;
  offSchedule: TopRouteRow[];
  reliable: TopRouteRow[];
  offScheduleDeltas: ReturnType<typeof computeRankDelta> | undefined;
  reliableDeltas: ReturnType<typeof computeRankDelta> | undefined;
  cancelledByRoute: Awaited<ReturnType<typeof getCancelledByRoute>>;
  /** A mode is chosen and none of its routes clears the bar. */
  noModeData: boolean;
}

/**
 * The week or month home's independent reads, each its own promise so each
 * streamed part waits only for its own: the verdict and boards for the
 * rankings, and each shame card for the board query it names. Sharing one
 * promise made the whole page wait for the slowest of them.
 */
export interface PeriodBatch {
  core: Promise<PeriodCore>;
  shame: Promise<ShameOfWeek>;
  shameRoute: Promise<ShameRouteOfWeek>;
  shameStop: Promise<ShameStopOfWeek>;
}

/**
 * Mark a promise as handled without changing it. The parts that await these
 * render in stream order, so one can reject before its part is reached, and
 * Node would report that as an unhandled rejection. The part still sees the
 * rejection when it awaits, so errors reach the error boundary as before.
 * @param p - The promise.
 * @returns The same promise.
 */
function handled<T>(p: Promise<T>): Promise<T> {
  p.catch(() => undefined);
  return p;
}

/**
 * Start the week or month reads. Called once per request and not awaited: each
 * streamed part awaits the promise it needs, so the queries run once however
 * many parts read them.
 * @param view - The window, filters and range to load.
 * @returns The three reads, in flight.
 */
export function loadPeriodBatch(view: PeriodView): PeriodBatch {
  const { mode, schools, range } = view;
  return {
    core: handled(loadPeriodCore(view)),
    shame: handled(getShameOfWeek(range, { mode, schools }, REVALIDATE)),
    shameRoute: handled(getShameRouteOfWeek(range, { mode, schools }, REVALIDATE)),
    shameStop: handled(getWorstStopsOfWeek(range, { mode, schools }, REVALIDATE)),
  };
}

/**
 * Run the ranking queries and derive the verdict strip and the boards.
 * @param view - The window, filters and range to load.
 * @returns The derived figures.
 */
async function loadPeriodCore(view: PeriodView): Promise<PeriodCore> {
  const { window, mode, dir, schools, period, range, anchor, filters } = view;
  // The first week and the first month have no real previous window: resolvePrevRange
  // clamps it away to nothing, and querying that would rank every route as a new entry.
  const prevRange = resolvePrevRange(window, period, anchor);
  const [rows, prevRows, [cancelled, cancelledByRoute, cancelledWithoutSchool]] = await Promise.all(
    [
      getFilteredRankings(range, filters, REVALIDATE),
      // The previous window under the same filters, so a rank arrow compares
      // like with like (last month's Saturdays against this month's).
      rangeIsEmpty(prevRange)
        ? Promise.resolve<TopRouteRow[]>([])
        : getFilteredRankings(prevRange, filters, REVALIDATE),
      hasRankingFilters(filters)
        ? getFilteredCancellations(range, filters, { mode, schools }).then(
            (c) => [c.total, c.byRoute, schools === "include" ? c.withoutSchool : null] as const,
          )
        : Promise.all([
            getCancelledCount(range, { mode, schools }, REVALIDATE),
            getCancelledByRoute(range, { mode, schools }, REVALIDATE),
            // The count school services leave out, for the "+N" beside each figure.
            schools === "include"
              ? getCancelledCount(range, { mode, schools: "exclude" }, REVALIDATE)
              : null,
          ]),
    ],
  );
  const modeFiltered = mode ? rows.filter((r) => r.mode === mode) : rows;
  const visible = modeFiltered.filter((r) =>
    schoolAllows(schools, isSchoolBus(r.short_name, r.long_name)),
  );
  // A single-mode view uses a lower bar so low-frequency modes (ferries) appear.
  const boardMin = mode ? MIN_MODE_EVENTS : MIN_BOARD_EVENTS;
  // Full ranked lists: the boards show the top 10 and link to the rest on the
  // Routes page, and deltas are computed across the whole list (current and previous).
  const boards = deriveBoards(visible, { minEvents: boardMin, size: Infinity });
  const offSchedule = deriveOffSchedule(visible, {
    minEvents: boardMin,
    direction: dir,
    size: Infinity,
  });
  const prevFiltered = (mode ? prevRows.filter((r) => r.mode === mode) : prevRows).filter((r) =>
    schoolAllows(schools, isSchoolBus(r.short_name, r.long_name)),
  );
  const hasPrev = prevFiltered.length > 0;
  return {
    // The KPI strip reflects exactly the visible rows, so the mode filter and the
    // school-bus toggle both flow through to the totals (no separate fleet query).
    // Cancellations are the exception: they produce no arrival row, so they come
    // from their own count under the same filters.
    heroData: { ...summariseRows(visible), cancelled },
    // "+N" only when school services sit beside the rest; alone they add to nothing.
    schoolAdded:
      schools === "include" ? schoolDelta(visible, cancelled, cancelledWithoutSchool) : null,
    availableModes: new Set(rows.filter((r) => r.events >= boardMin).map((r) => r.mode)),
    offSchedule,
    reliable: boards.reliable,
    offScheduleDeltas: hasPrev
      ? computeRankDelta(
          offSchedule,
          deriveOffSchedule(prevFiltered, { minEvents: boardMin, direction: dir, size: Infinity }),
        )
      : undefined,
    reliableDeltas: hasPrev
      ? computeRankDelta(
          boards.reliable,
          deriveBoards(prevFiltered, { minEvents: boardMin, size: Infinity }).reliable,
        )
      : undefined,
    cancelledByRoute,
    noModeData: mode !== null && visible.every((r) => r.events < boardMin),
  };
}

/**
 * The verdict and KPI strip for the period.
 * @param props - Component props.
 * @param props.batch - The period's reads.
 * @returns The strip.
 */
export async function PeriodVerdict({ batch }: { batch: PeriodBatch }): Promise<JSX.Element> {
  const core = await batch.core;
  return <FleetSummary data={core.heroData} verdict schoolAdded={core.schoolAdded} />;
}

/**
 * The mode chips once the rankings know which modes have data. Until then the
 * page shows every chip, which is this element minus the hidden ones.
 * @param props - Component props.
 * @param props.batch - The period's reads.
 * @param props.active - The active mode, or null for "All".
 * @param props.preservedParams - Query params the chips keep.
 * @returns The chips.
 */
export async function PeriodModeFilter({
  batch,
  active,
  preservedParams,
}: {
  batch: PeriodBatch;
  active: RankMode;
  preservedParams: Record<string, string>;
}): Promise<JSX.Element> {
  return (
    <ModeFilter
      active={active}
      basePath="/"
      preservedParams={preservedParams}
      availableModes={(await batch.core).availableModes}
    />
  );
}

/**
 * The period's worst-run card, as the worst-trips board crowns it. It opens that
 * run, on the day it ran.
 * @param props - Component props.
 * @param props.batch - The period's reads.
 * @param props.when - The shown window as words, for the empty-state copy.
 * @returns The card.
 */
export async function PeriodTripCard({
  batch,
  when,
}: {
  batch: PeriodBatch;
  when: string;
}): Promise<JSX.Element> {
  const shame = await batch.shame;
  return <ShameOfDay trip={shame.worst} ranked={shame.days.length > 0} when={when} />;
}

/**
 * The period's worst-route card, as the worst-routes board crowns it. Its
 * figures are one day's, so it opens the route on that day.
 * @param props - Component props.
 * @param props.batch - The period's reads.
 * @param props.when - The shown window as words, for the empty-state copy.
 * @returns The card.
 */
export async function PeriodRouteCard({
  batch,
  when,
}: {
  batch: PeriodBatch;
  when: string;
}): Promise<JSX.Element> {
  const shame = await batch.shameRoute;
  return (
    <WorstRouteCard
      route={shame.worst}
      ranked={shame.days.length > 0}
      when={when}
      day={shame.worst?.date}
    />
  );
}

/**
 * The period's worst-stop card, as the worst-stops board crowns it. Its figures
 * are one day's, so it opens the stop on that day rather than on a window
 * /stop cannot show.
 * @param props - Component props.
 * @param props.batch - The period's reads.
 * @param props.when - The shown window as words, for the empty-state copy.
 * @returns The card.
 */
export async function PeriodStopCard({
  batch,
  when,
}: {
  batch: PeriodBatch;
  when: string;
}): Promise<JSX.Element> {
  const shame = await batch.shameStop;
  return (
    <WorstStopCard
      stop={shame.worst}
      ranked={shame.days.length > 0}
      when={when}
      day={shame.worst?.date}
    />
  );
}

/**
 * The two rank boards with rank movement against the previous period, the
 * not-enough-data note above them and the refresh note below.
 * @param props - Component props.
 * @param props.batch - The period's reads.
 * @param props.view - The window and filters the batch was loaded for.
 * @returns The boards.
 */
export async function PeriodBoards({
  batch,
  view,
}: {
  batch: PeriodBatch;
  view: PeriodView;
}): Promise<JSX.Element> {
  const { window, mode, dir, schools, period, filters } = view;
  const b = await batch.core;
  // No hours on the route links: the route page's week view has no part-of-day
  // figures to open on.
  const routeQuery = routeLinkQuery(window, null, period);
  // The same bar loadPeriodCore ranked by, so an empty board can name it.
  const boardMin = mode ? MIN_MODE_EVENTS : MIN_BOARD_EVENTS;
  return (
    <>
      {b.noModeData && mode && (
        <p className="text-sm text-at-muted">
          Not enough {mode.charAt(0) + mode.slice(1).toLowerCase()} data for this period - try a
          wider window or switch back to All.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <RankBoard
          title="Most off-schedule"
          accentClass="text-at-ink"
          rows={b.offSchedule.slice(0, BOARD_SIZE)}
          metric="delay"
          caption={ON_TIME_CAPTION}
          cancelled={b.cancelledByRoute}
          deltas={b.offScheduleDeltas}
          routeQuery={routeQuery}
          total={b.offSchedule.length}
          minEvents={boardMin}
          seeAllHref={buildHref("/routes", {
            window,
            period,
            ...viewQuery("off", { mode, school: schools, lean: dir, areas: filters.areas }),
          })}
        />
        <RankBoard
          title="Most reliable"
          accentClass="text-at-ontime"
          rows={b.reliable.slice(0, BOARD_SIZE)}
          metric="onTime"
          caption={ON_TIME_SHARE_CAPTION}
          deltas={b.reliableDeltas}
          routeQuery={routeQuery}
          total={b.reliable.length}
          minEvents={boardMin}
          seeAllHref={buildHref("/routes", {
            window,
            period,
            ...viewQuery("reliable", { mode, school: schools, areas: filters.areas }),
          })}
        />
      </div>

      <p className="text-xs text-at-muted">
        Rankings are built from real-time arrivals and refresh hourly. {CANCELLED_SPLIT_COPY}
        {(b.offScheduleDeltas || b.reliableDeltas) &&
          ` Movement arrows compare each route to its position in the previous ${window === "month" ? "month" : "week"}.`}
      </p>
    </>
  );
}
