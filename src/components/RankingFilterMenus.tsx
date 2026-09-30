"use client";
// src/components/RankingFilterMenus.tsx
// The home page's narrowing filters: a start and a finish time, day type on a
// week or month, and area. Each choice navigates, keeping every other param, so
// the server re-ranks under it.

import { choiceSummary, FilterMenu, FilterOption } from "@/components/FilterMenu";
import { AREAS, type AreaKey } from "@/lib/areas";
import { cn } from "@/lib/cn";
import { AREA_PARAM } from "@/lib/ranking-filters";
import { DAY_TYPES, DAYS_PARAM, type DayType } from "@/lib/time/day-type";
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
import { useId, type JSX } from "react";

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
            aria-pressed={o.hour === value}
            onClick={() => onPick(o.hour)}
            className={cn(
              "h-9 border text-xs font-semibold tabular-nums transition-colors",
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
 * The time, day and area filter boxes. The time box opens a From grid and a To
 * grid in the day's own 4am-to-4am order: the start runs from the service day's
 * first hour, the finish up to its end, which reads "Now" while the day is under
 * way. An hour on the wrong side of the other pick is greyed out, as is an hour
 * that has not come yet today, so the pair is always a real stretch of the day;
 * both at their ends clears the filter.
 * @param props - Component props.
 * @param props.basePath - Page path the choices navigate to.
 * @param props.preservedParams - Every other param the page carries; the three
 *   filter params are set here.
 * @param props.hours - The active part of the day, or null for all of it.
 * @param props.days - The active day type, or null for every day.
 * @param props.areas - The chosen areas, empty for anywhere.
 * @param props.showDays - Whether to offer the day type (a week or month).
 * @param props.nowHour - The Auckland hour now when the window is the day still
 *   under way, or null for a finished day, a week or a month.
 * @returns The controls.
 */
export function RankingFilterMenus({
  basePath,
  preservedParams,
  hours,
  days,
  areas,
  showDays,
  nowHour,
}: {
  basePath: string;
  preservedParams: Record<string, string>;
  hours: HourRange | null;
  days: DayType | null;
  areas: readonly AreaKey[];
  showDays: boolean;
  nowHour: number | null;
}): JSX.Element {
  const router = useRouter();
  const daysName = useId();
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
   * Navigate with some filter params changed and the rest kept.
   * @param params - The params to set; undefined clears one.
   */
  const go = (params: Record<string, string | undefined>): void => {
    router.push(
      buildHref(basePath, {
        ...preservedParams,
        [HOURS_PARAM]: hourRangeParam(hours),
        [DAYS_PARAM]: days ?? undefined,
        [AREA_PARAM]: areas.length > 0 ? areas.join(",") : undefined,
        ...params,
      }),
      { scroll: false },
    );
  };

  /**
   * Set the start and finish. Both at the day's ends is the whole day, so the
   * param comes off rather than naming a range that narrows nothing.
   * @param start - The start hour.
   * @param end - The finish hour; the service start hour means the day's end.
   */
  const setHours = (start: number, end: number): void => {
    const whole = start === SERVICE_START_HOUR && end === SERVICE_START_HOUR;
    go({ [HOURS_PARAM]: whole ? undefined : hourRangeParam({ from: start, to: end }) });
  };

  /**
   * Add or remove one area, keeping the list in display order.
   * @param key - The area.
   */
  const toggleArea = (key: AreaKey): void => {
    const next = areas.includes(key)
      ? areas.filter((a) => a !== key)
      : AREAS.map((a) => a.key).filter((a) => a === key || areas.includes(a));
    go({ [AREA_PARAM]: next.length > 0 ? next.join(",") : undefined });
  };

  return (
    <>
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

      {showDays && (
        <FilterMenu
          label="Days"
          summary={DAY_TYPES.find((d) => d.key === days)?.label ?? null}
          onReset={() => go({ [DAYS_PARAM]: undefined })}
        >
          <FilterOption
            type="radio"
            name={daysName}
            checked={days === null}
            onChange={() => go({ [DAYS_PARAM]: undefined })}
          >
            Every day
          </FilterOption>
          {DAY_TYPES.map((d) => (
            <FilterOption
              key={d.key}
              type="radio"
              name={daysName}
              checked={days === d.key}
              onChange={() => go({ [DAYS_PARAM]: d.key })}
            >
              {d.label}
            </FilterOption>
          ))}
        </FilterMenu>
      )}

      <FilterMenu
        label="Area"
        summary={choiceSummary(AREAS.filter((a) => areas.includes(a.key)).map((a) => a.label))}
        onReset={() => go({ [AREA_PARAM]: undefined })}
      >
        {AREAS.map((a) => (
          <FilterOption
            key={a.key}
            type="checkbox"
            checked={areas.includes(a.key)}
            onChange={() => toggleArea(a.key)}
          >
            {a.label}
          </FilterOption>
        ))}
      </FilterMenu>
    </>
  );
}
