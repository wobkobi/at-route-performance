// src/components/DayNav.tsx
// Date label with previous/next day stepper links for the shame views.
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { StepPending } from "@/components/StepPending";
import { serviceDayLabel, shiftWeek } from "@/lib/time";
import { buildHref } from "@/lib/utils";
import Link from "next/link";
import type { JSX } from "react";

/** Props for {@link DayNav}. */
export interface DayNavProps {
  /** Page path the day links point at. */
  basePath: string;
  /** The shown service date as `YYYY-MM-DD`. */
  serviceDate: string;
  /** Query params to preserve on the links (the `day` param is set here). */
  preservedParams: Record<string, string>;
  /** Whether a previous (earlier) day link should be offered (false on the earliest day with data). */
  hasPrev: boolean;
  /** Whether a next (later) day link should be offered (false on the latest day). */
  hasNext: boolean;
  /**
   * Override href for the next-day link. Pass the clean base URL when the next
   * day is today so the server's `dropTodayParam` redirect is never triggered.
   */
  nextHref?: string;
  /** Whether the shown day is the archive's first, so the absent chevron reads as a fact. */
  atFloor?: boolean;
}

/**
 * Build a day link href preserving the other params.
 * @param basePath - Page path.
 * @param preserved - Params to keep.
 * @param day - The `day` value to set.
 * @returns The href.
 */
function dayHref(basePath: string, preserved: Record<string, string>, day: string): string {
  return buildHref(basePath, { ...preserved, day });
}

/**
 * Service-day stepper: prev / current date / next, as `?day=` links. The prev
 * link is omitted on the earliest service day with data and the next link on the
 * latest, so you cannot page past where data exists in either direction.
 *
 * Both links prefetch in full. A dynamic page otherwise prefetches only down to
 * its loading skeleton, which leaves a step to start its data fetch on the click
 * and show the skeleton for as long as the day takes to compute. A neighbouring
 * day is the one navigation that can be predicted, and a past one is held in the
 * Data Cache for a week once summarised, so fetching it while the reader looks at
 * this day is cheap and makes the step itself immediate. A click that lands
 * before that fetch has finished pulses its chevron ({@link StepPending}) until
 * the day arrives.
 * @param props - Component props.
 * @param props.basePath - Page path the day links point at.
 * @param props.serviceDate - The shown service date (`YYYY-MM-DD`).
 * @param props.preservedParams - Query params to keep when changing day.
 * @param props.hasPrev - Whether to offer a previous-day link.
 * @param props.hasNext - Whether to offer a next-day link.
 * @param props.nextHref - Override href for the next-day link; pass the clean base URL when the next day is today to skip the server redirect.
 * @param props.atFloor - Whether the shown day is the archive's first, so the missing previous chevron gets a reason.
 * @returns The day navigation element.
 */
export function DayNav({
  basePath,
  serviceDate,
  preservedParams,
  hasPrev,
  hasNext,
  nextHref,
  atFloor = false,
}: DayNavProps): JSX.Element {
  return (
    <div className="flex items-center gap-1">
      {/* Step links are omitted (not disabled) at the edges of the data range;
          on the archive's first day the gap gets a reason instead. */}
      {hasPrev && (
        <Link
          href={dayHref(basePath, preservedParams, shiftWeek(serviceDate, -1))}
          prefetch
          className="chip chip-off"
          aria-label="Previous day"
        >
          <StepPending>
            <ChevronLeft />
          </StepPending>
        </Link>
      )}
      {!hasPrev && atFloor && <span className="px-1 text-xs text-at-muted">first day</span>}
      <span className="px-2 text-sm font-semibold tabular-nums">
        {serviceDayLabel(serviceDate)}
      </span>
      {hasNext && (
        <Link
          href={nextHref ?? dayHref(basePath, preservedParams, shiftWeek(serviceDate, 1))}
          prefetch
          className="chip chip-off"
          aria-label="Next day"
        >
          <StepPending>
            <ChevronRight />
          </StepPending>
        </Link>
      )}
    </div>
  );
}
