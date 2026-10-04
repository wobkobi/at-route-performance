"use client";
// src/components/ranking/RankingFilterMenus.tsx
// The home page's narrowing filters: a start and a finish time, day type on a
// week or month, and area. Each choice navigates, keeping every other param, so
// the server re-ranks under it.

import { choiceSummary, FilterMenu, FilterOption } from "@/components/filter/FilterMenu";
import { HourRangeFilter } from "@/components/filter/HourRangeFilter";
import { labelOf, labelsOf } from "@/lib/collections";
import { AREAS, type AreaKey } from "@/lib/geo/areas";
import { AREA_PARAM } from "@/lib/ranking-filters";
import { DAY_TYPE_PARAM, DAY_TYPES, type DayType } from "@/lib/time/day-type";
import { hourRangeParam, HOURS_PARAM, type HourRange } from "@/lib/time/time-of-day";
import { buildHref } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useId, type JSX } from "react";

/**
 * The time, day and area filter boxes; the time box is the shared
 * {@link HourRangeFilter}.
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
  // Every filter param as it stands, so a change to one keeps the others.
  const current: Record<string, string | undefined> = {
    ...preservedParams,
    [HOURS_PARAM]: hourRangeParam(hours),
    [DAY_TYPE_PARAM]: days ?? undefined,
    [AREA_PARAM]: areas.length > 0 ? areas.join(",") : undefined,
  };

  /**
   * Navigate with some filter params changed and the rest kept.
   * @param params - The params to set; undefined clears one.
   */
  const go = (params: Record<string, string | undefined>): void => {
    router.push(buildHref(basePath, { ...current, ...params }), { scroll: false });
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
      <HourRangeFilter basePath={basePath} params={current} hours={hours} nowHour={nowHour} />

      {showDays && (
        <FilterMenu
          label="Days"
          summary={labelOf(DAY_TYPES, days) ?? null}
          onReset={() => go({ [DAY_TYPE_PARAM]: undefined })}
        >
          <FilterOption
            type="radio"
            name={daysName}
            checked={days === null}
            onChange={() => go({ [DAY_TYPE_PARAM]: undefined })}
          >
            Every day
          </FilterOption>
          {DAY_TYPES.map((d) => (
            <FilterOption
              key={d.key}
              type="radio"
              name={daysName}
              checked={days === d.key}
              onChange={() => go({ [DAY_TYPE_PARAM]: d.key })}
            >
              {d.label}
            </FilterOption>
          ))}
        </FilterMenu>
      )}

      <FilterMenu
        label="Area"
        summary={choiceSummary(labelsOf(AREAS, areas))}
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
