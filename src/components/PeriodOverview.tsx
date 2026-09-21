// src/components/PeriodOverview.tsx
// The home page's week or month data: one ranking batch, loaded once and
// streamed into three places (the verdict strip, the shame cards and the rank
// boards), so the headings and filter chips between them render straight away.
// A cold month fans out to ~30 per-day aggregations, which is why none of it
// blocks the page shell.

import { FleetSummary } from "@/components/FleetSummary";
import { ModeFilter } from "@/components/ModeFilter";
import { ON_TIME_CAPTION, ON_TIME_SHARE_CAPTION, RankBoard } from "@/components/RankBoard";
import { ShameOfDay } from "@/components/ShameOfDay";
import { WorstStopCard } from "@/components/WorstStopCard";
import {
  getCancelledByRoute,
  getCancelledCount,
  getRankings,
  getShameOfWeek,
  getWorstStops,
} from "@/lib/data";
import { rangeIsEmpty } from "@/lib/data-start";
import { CANCELLED_SPLIT_COPY, ON_TIME_LATE_SEC } from "@/lib/on-time";
import { routeLinkQuery } from "@/lib/range-page";
import {
  computeRankDelta,
  deriveBoards,
  deriveOffSchedule,
  MIN_BOARD_EVENTS,
  MIN_MODE_EVENTS,
  summariseRows,
  type DelayDirection,
} from "@/lib/rankings";
import { resolvePrevRange, type RankMode, type RankWindow } from "@/lib/rankings-page";
import { viewQuery } from "@/lib/route-explorer";
import { isSchoolBus } from "@/lib/school-bus";
import type { DateRange } from "@/lib/time";
import { buildHref } from "@/lib/utils";
import type { TopRouteRow } from "@/types/api";
import type { FleetSummary as FleetSummaryData } from "@/types/dashboard";
import type { JSX } from "react";

// Late bound for the on-time window + cache-key versioning; early side is per-mode.
const THRESHOLD_SEC = ON_TIME_LATE_SEC;
const REVALIDATE = 3600; // 1 hour
/** Routes each board shows; the full ranking is on the Routes page. */
const BOARD_SIZE = 10;

/** The view a period batch is loaded for. */
export interface PeriodView {
  window: RankWindow;
  mode: RankMode;
  dir: DelayDirection;
  includeSchool: boolean;
  /** Raw `?period=` value, used for the previous range and row links. */
  period: string | undefined;
  range: DateRange;
  /** The latest day with data (or now). */
  anchor: Date;
}

/** Everything the three streamed parts of the week or month home render from. */
export interface PeriodBatch {
  heroData: FleetSummaryData;
  /** Modes with at least one route over the board bar, for the mode chips. */
  availableModes: Set<string>;
  shame: Awaited<ReturnType<typeof getShameOfWeek>>;
  worstStop: Awaited<ReturnType<typeof getWorstStops>>[number] | null;
  offSchedule: TopRouteRow[];
  reliable: TopRouteRow[];
  offScheduleDeltas: ReturnType<typeof computeRankDelta> | undefined;
  reliableDeltas: ReturnType<typeof computeRankDelta> | undefined;
  cancelledByRoute: Awaited<ReturnType<typeof getCancelledByRoute>>;
  /** A mode is chosen and none of its routes clears the bar. */
  noModeData: boolean;
}

/**
 * Run the week or month ranking batch and derive every figure the page shows.
 * Called once per request; the promise is handed to each streamed part, so the
 * queries run once however many parts await it.
 * @param view - The window, filters and range to load.
 * @returns The derived batch.
 */
export async function loadPeriodBatch(view: PeriodView): Promise<PeriodBatch> {
  const { window, mode, dir, includeSchool, period, range, anchor } = view;
  // The first week and the first month have no real previous window: resolvePrevRange
  // clamps it away to nothing, and querying that would rank every route as a new entry.
  const prevRange = resolvePrevRange(window, period, anchor);
  const [rows, worstStops, prevRows, shame, cancelled, cancelledByRoute] = await Promise.all([
    getRankings(range, THRESHOLD_SEC, REVALIDATE),
    getWorstStops(range, { mode, includeSchool }, 1, REVALIDATE),
    rangeIsEmpty(prevRange)
      ? Promise.resolve<TopRouteRow[]>([])
      : getRankings(prevRange, THRESHOLD_SEC, REVALIDATE),
    getShameOfWeek(range, { mode, includeSchool }, REVALIDATE),
    getCancelledCount(range, { mode, includeSchool }, REVALIDATE),
    getCancelledByRoute(range, { mode, includeSchool }, REVALIDATE),
  ]);
  const modeFiltered = mode ? rows.filter((r) => r.mode === mode) : rows;
  const visible = includeSchool
    ? modeFiltered
    : modeFiltered.filter((r) => !isSchoolBus(r.short_name, r.long_name));
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
  const prevFiltered = (mode ? prevRows.filter((r) => r.mode === mode) : prevRows).filter(
    (r) => includeSchool || !isSchoolBus(r.short_name, r.long_name),
  );
  const hasPrev = prevFiltered.length > 0;
  return {
    // The KPI strip reflects exactly the visible rows, so the mode filter and the
    // school-bus toggle both flow through to the totals (no separate fleet query).
    // Cancellations are the exception: they produce no arrival row, so they come
    // from their own count under the same filters.
    heroData: { ...summariseRows(visible), cancelled },
    availableModes: new Set(rows.filter((r) => r.events >= boardMin).map((r) => r.mode)),
    shame,
    worstStop: worstStops[0] ?? null,
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
 * @param props.batch - The period's batch.
 * @returns The strip.
 */
export async function PeriodVerdict({
  batch,
}: {
  batch: Promise<PeriodBatch>;
}): Promise<JSX.Element> {
  return <FleetSummary data={(await batch).heroData} verdict />;
}

/**
 * The mode chips once the batch knows which modes have data. Until then the
 * page shows every chip, which is this element minus the hidden ones.
 * @param props - Component props.
 * @param props.batch - The period's batch.
 * @param props.active - The active mode, or null for "All".
 * @param props.preservedParams - Query params the chips keep.
 * @returns The chips.
 */
export async function PeriodModeFilter({
  batch,
  active,
  preservedParams,
}: {
  batch: Promise<PeriodBatch>;
  active: RankMode;
  preservedParams: Record<string, string>;
}): Promise<JSX.Element> {
  return (
    <ModeFilter
      active={active}
      basePath="/"
      preservedParams={preservedParams}
      availableModes={(await batch).availableModes}
    />
  );
}

/**
 * The worst-run and worst-stop cards for the period.
 * @param props - Component props.
 * @param props.batch - The period's batch.
 * @param props.window - The active window, for the empty-state copy.
 * @param props.stopHref - Where the stop card leads.
 * @returns The two-card grid.
 */
export async function PeriodShameCards({
  batch,
  window,
  stopHref,
}: {
  batch: Promise<PeriodBatch>;
  window: RankWindow;
  stopHref: string;
}): Promise<JSX.Element> {
  const { shame, worstStop } = await batch;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* The run card opens that run; the stop card stays on the shame board,
          because /stop reads `?day` only and cannot show a week or a month. */}
      <ShameOfDay trip={shame.worst} period={window} />
      <WorstStopCard stop={worstStop} href={stopHref} />
    </div>
  );
}

/**
 * The two rank boards with rank movement against the previous period, the
 * not-enough-data note above them and the refresh note below.
 * @param props - Component props.
 * @param props.batch - The period's batch.
 * @param props.view - The window and filters the batch was loaded for.
 * @returns The boards.
 */
export async function PeriodBoards({
  batch,
  view,
}: {
  batch: Promise<PeriodBatch>;
  view: PeriodView;
}): Promise<JSX.Element> {
  const { window, mode, dir, includeSchool, period } = view;
  const b = await batch;
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
          routeQuery={routeLinkQuery(window, null, period)}
          total={b.offSchedule.length}
          seeAllHref={buildHref("/routes", {
            window,
            period,
            ...viewQuery("off", { mode, school: includeSchool, lean: dir }),
          })}
        />
        <RankBoard
          title="Most reliable"
          accentClass="text-at-ontime"
          rows={b.reliable.slice(0, BOARD_SIZE)}
          metric="onTime"
          caption={ON_TIME_SHARE_CAPTION}
          deltas={b.reliableDeltas}
          routeQuery={routeLinkQuery(window, null, period)}
          total={b.reliable.length}
          seeAllHref={buildHref("/routes", {
            window,
            period,
            ...viewQuery("reliable", { mode, school: includeSchool }),
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
