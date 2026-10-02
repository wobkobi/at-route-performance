// src/components/date/DayNav.tsx
// Date label with previous/next day stepper links for the shame views.
import { StepperLink } from "@/components/Chip";
import { DatePicker } from "@/components/date/DatePicker";
import { StepPending } from "@/components/date/StepPending";
import { Hint } from "@/components/ui/Hint";
import type { PickerState } from "@/lib/time/calendar";
import { serviceDayLabel, serviceDayWindowText, shiftDays } from "@/lib/time/service-day";
import { buildHref } from "@/lib/utils";
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
  /** Whether the next day is today and has not opened, so the absent next chevron gets a reason. */
  nextPending?: boolean;
  /** The date picker's bounds; the label opens a calendar when given them. */
  calendar?: PickerState;
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
 * @param props.nextPending - Whether the next day is today and not yet open, so the missing next chevron gets a reason.
 * @param props.calendar - The date picker's bounds; the label opens a calendar when given them.
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
  nextPending = false,
  calendar,
}: DayNavProps): JSX.Element {
  return (
    <div className="flex items-center gap-1">
      {/* Step links are omitted (not disabled) at the edges of the data range,
          and a `.step-slot` holds the gap so stepping onto the newest or oldest
          day does not shift the label and the tabs beside it. The two edge
          sentences take the slot's place rather than sitting beside it, so only
          those states - the archive's first day, and today before it opens -
          change the row's width. `scroll` is held because the stepper is how the
          archive is read: stepping from halfway down a board threw the reader
          back to the top of the next day, while a mode chip beside it did not. */}
      <StepperLink
        href={hasPrev ? dayHref(basePath, preservedParams, shiftDays(serviceDate, -1)) : null}
        dir="prev"
        label="Previous day"
        fallback={
          atFloor ? <span className="px-1 text-xs text-at-muted">first day</span> : undefined
        }
      />
      {/* Every day page shows a day through this label, so the window it covers
          is said here once rather than on each page. The width is reserved for a
          two-digit day, so stepping from the 1st to the 2nd of a month does not
          move the row either. Given the bounds, it opens a calendar. */}
      {calendar ? (
        <DatePicker
          mode="day"
          calendar={calendar}
          basePath={basePath}
          preservedParams={preservedParams}
          hint={`${serviceDayWindowText(serviceDate)}. Choose a date.`}
          className="min-w-24 px-2 py-1 text-center text-sm font-semibold tabular-nums"
        >
          {serviceDayLabel(serviceDate)}
        </DatePicker>
      ) : (
        <Hint
          hint={serviceDayWindowText(serviceDate)}
          triggerClassName="min-w-24 px-2 text-center text-sm font-semibold tabular-nums"
        >
          {serviceDayLabel(serviceDate)}
        </Hint>
      )}
      <StepperLink
        href={
          hasNext
            ? (nextHref ?? dayHref(basePath, preservedParams, shiftDays(serviceDate, 1)))
            : null
        }
        dir="next"
        label="Next day"
        fallback={
          nextPending ? (
            <Hint
              hint="Today began at 4am but has too few arrivals so far, so this shows the day before"
              triggerClassName="px-1 text-xs text-at-muted"
            >
              today still starting
            </Hint>
          ) : undefined
        }
      />
    </div>
  );
}
