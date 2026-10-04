"use client";
// src/components/filter/HourRangeFilter.tsx
// The "Time" filter box: a From grid and a To grid of hours in the service
// day's 4am-to-4am order. Picking an hour navigates, keeping every other param.

import { FilterMenu } from "@/components/filter/FilterMenu";
import { cn } from "@/lib/cn";
import { nzHourLabel, SERVICE_START_HOUR } from "@/lib/time/service-day";
import {
  hourRangeClock,
  hourRangeParam,
  HOURS_PARAM,
  serviceHourIndex,
  type HourRange,
} from "@/lib/time/time-of-day";
import { buildHref } from "@/lib/utils";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

/** The hours in service-day order, 4am first. */
const DAY_HOURS = Array.from({ length: 24 }, (_, i) => (SERVICE_START_HOUR + i) % 24);

/** One hour in a {@link HourGrid}. */
interface HourOption {
  hour: number;
  text: string;
  disabled: boolean;
}

/**
 * A grid of hour buttons, six to a row so a whole day is four short rows
 * rather than a list the height of the screen.
 * @param props - Component props.
 * @param props.label - What the hours pick, "From" or "To".
 * @param props.options - The hours, in service-day order.
 * @param props.value - The chosen hour.
 * @param props.onPick - Choose an hour.
 * @returns The labelled grid.
 */
function HourGrid({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: readonly HourOption[];
  value: number;
  onPick: (hour: number) => void;
}): JSX.Element {
  return (
    <fieldset className="px-1.5 pb-2">
      <legend className="pt-1 pb-1.5 text-sm font-semibold text-at-ink">{label}</legend>
      <div className="grid grid-cols-6 gap-1">
        {options.map((o) => (
          <button
            key={o.hour}
            type="button"
            disabled={o.disabled}
            aria-current={o.hour === value ? "true" : undefined}
            onClick={() => onPick(o.hour)}
            className={cn(
              "h-11 border text-xs font-semibold tabular-nums transition-colors",
              o.hour === value
                ? "border-at-shore bg-at-shore text-white"
                : "border-at-border bg-at-surface text-at-ink hover:border-at-shore hover:text-at-shore",
              "disabled:cursor-not-allowed disabled:border-at-border disabled:bg-at-surface disabled:text-at-muted disabled:opacity-40",
            )}
          >
            {o.text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The Time filter box. The start runs from the service day's first hour, the
 * finish up to its end, which reads "Now" while the day is under way. An hour on
 * the wrong side of the other pick is greyed out, as is an hour that has not come
 * yet today, so the pair is always a real stretch of the day; both at their ends
 * clears the filter.
 * @param props - Component props.
 * @param props.basePath - Page path a pick navigates to.
 * @param props.params - Every other param the page carries; `hours` is set here.
 * @param props.hours - The active part of the day, or null for all of it.
 * @param props.nowHour - The Auckland hour now when the window is the day still
 *   under way, or null for a finished day, a week or a month.
 * @returns The filter box.
 */
export function HourRangeFilter({
  basePath,
  params,
  hours,
  nowHour,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  hours: HourRange | null;
  nowHour: number | null;
}): JSX.Element {
  const router = useRouter();
  const live = nowHour !== null;
  // Past the hour under way nothing has run yet, so later hours are greyed.
  const nowIndex = nowHour === null ? 23 : serviceHourIndex(nowHour);
  const from = hours?.from ?? SERVICE_START_HOUR;
  const to = hours?.to ?? SERVICE_START_HOUR;
  const fromIndex = serviceHourIndex(from);
  // The day's end is the 4am that closes it, hour 24 of the service day, not
  // the 4am that opens it.
  const toIndex = to === SERVICE_START_HOUR ? 24 : serviceHourIndex(to);

  /**
   * Set the start and finish. Both at the day's ends is the whole day, so the
   * param comes off rather than naming a range that narrows nothing.
   * @param start - The start hour.
   * @param end - The finish hour; the service start hour means the day's end.
   */
  const setHours = (start: number, end: number): void => {
    const whole = start === SERVICE_START_HOUR && end === SERVICE_START_HOUR;
    router.push(
      buildHref(basePath, {
        ...params,
        [HOURS_PARAM]: whole ? undefined : hourRangeParam({ from: start, to: end }),
      }),
      { scroll: false },
    );
  };

  return (
    <FilterMenu
      label="Time"
      summary={hours ? hourRangeClock(hours, live) : null}
      onReset={() => setHours(SERVICE_START_HOUR, SERVICE_START_HOUR)}
      wide
    >
      <HourGrid
        label="From"
        value={from}
        onPick={(h) => setHours(h, to)}
        options={DAY_HOURS.map((h) => ({
          hour: h,
          text: nzHourLabel(h),
          disabled: serviceHourIndex(h) >= toIndex || serviceHourIndex(h) > nowIndex,
        }))}
      />
      {/* The day's own 4am comes last, as its end: "Now" while it runs. */}
      <HourGrid
        label="To"
        value={to}
        onPick={(h) => setHours(from, h)}
        options={[...DAY_HOURS.slice(1), SERVICE_START_HOUR].map((h) =>
          h === SERVICE_START_HOUR
            ? { hour: h, text: live ? "Now" : "End", disabled: false }
            : {
                hour: h,
                text: nzHourLabel(h),
                disabled: serviceHourIndex(h) <= fromIndex || serviceHourIndex(h) > nowIndex + 1,
              },
        )}
      />
    </FilterMenu>
  );
}
