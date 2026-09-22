// src/components/DayChart.tsx
// The Day by day page's column chart: one column per service day, as tall as
// the day's on-time share and coloured by its verdict band, over faint guide
// lines at the band floors so each day's word reads straight off the chart.
// Plain HTML boxes rather than SVG or a chart library, rendered on the server.

import { cn } from "@/lib/cn";
import type { DaySlot } from "@/lib/day-series";
import { serviceDayLabel, weekdayShort } from "@/lib/time";
import { VERDICT_BANDS } from "@/lib/verdict";
import Link from "next/link";
import type { JSX } from "react";

/**
 * The on-time share at the chart's baseline. Every day on record sits between
 * 60% and 70%, so a zero baseline would squash them into near-identical
 * columns; the guide labels name the scale, so the cut is stated, not hidden.
 */
export const CHART_FLOOR = 40;

/**
 * Height of an on-time share on the chart, as a percentage of the plot. A day
 * under the baseline keeps a 2% sliver, so it still reads as a day with data.
 * @param pct - The on-time share.
 * @returns The height percentage.
 */
function plotHeight(pct: number): number {
  return Math.min(100, Math.max(2, ((pct - CHART_FLOOR) / (100 - CHART_FLOOR)) * 100));
}

/**
 * The label under a column: the weekday and date on a week, the date alone on
 * a month, where below `sm` only Mondays and the first day keep theirs.
 * @param props - Component props.
 * @param props.slot - The day.
 * @param props.monthView - Whether the chart spans a month.
 * @param props.first - Whether this is the chart's first column.
 * @returns The label.
 */
function ColumnLabel({
  slot,
  monthView,
  first,
}: {
  slot: DaySlot;
  monthView: boolean;
  first: boolean;
}): JSX.Element {
  const dayOfMonth = Number(slot.date.slice(8));
  if (!monthView) {
    return (
      <span className="block text-center text-[10px] leading-tight text-at-muted sm:text-xs">
        {weekdayShort(slot.date)}
        <br />
        {dayOfMonth}
      </span>
    );
  }
  const keep = first || weekdayShort(slot.date) === "Mon";
  return (
    <span
      className={cn(
        "block text-center text-[10px] leading-tight text-at-muted tabular-nums",
        !keep && "invisible sm:visible",
      )}
    >
      {dayOfMonth}
    </span>
  );
}

/**
 * Render the column chart. It is a picture of the table beneath it: the columns
 * link for a mouse, but sit outside the tab order and the accessibility tree,
 * since every figure and link is in the table and a month of 10px columns is no
 * tap target.
 * @param props - Component props.
 * @param props.slots - The window's days, earliest first.
 * @param props.today - Today's service date, whose column is still filling.
 * @param props.hrefFor - The link for a day's column.
 * @param props.monthView - Whether the window is a month, for the labels.
 * @returns The chart.
 */
export function DayChart({
  slots,
  today,
  hrefFor,
  monthView,
}: {
  slots: readonly DaySlot[];
  today: string;
  hrefFor: (date: string) => string;
  monthView: boolean;
}): JSX.Element {
  const guides = VERDICT_BANDS.filter((b) => b.floor > CHART_FLOOR);
  return (
    <div aria-hidden className="border border-at-border bg-at-surface p-3 sm:p-4">
      <div className="flex">
        {/* Guide labels: each band's word at its floor, plus the baseline. */}
        <div className="relative h-48 w-14 shrink-0 sm:h-64 sm:w-18">
          {guides.map((b) => (
            <span
              key={b.label}
              className="absolute right-2 translate-y-1/2 text-[10px] leading-none whitespace-nowrap text-at-muted sm:text-xs"
              style={{ bottom: `${plotHeight(b.floor)}%` }}
            >
              {b.label} {b.floor}
            </span>
          ))}
          <span className="absolute right-2 bottom-0 translate-y-1/2 text-[10px] leading-none text-at-muted sm:text-xs">
            {CHART_FLOOR}%
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-48 border-b border-at-border sm:h-64">
            {guides.map((b) => (
              <div
                key={b.label}
                className="absolute inset-x-0 border-t border-dashed border-at-muted"
                style={{ bottom: `${plotHeight(b.floor)}%` }}
              />
            ))}
            <div className="absolute inset-0 flex items-end gap-px sm:gap-1">
              {slots.map((s) => (
                <div key={s.date} className="flex h-full min-w-0 flex-1 items-end">
                  {s.kind === "day" && s.summary.on_time_pct !== null && (
                    <Link
                      href={hrefFor(s.date)}
                      tabIndex={-1}
                      title={`${serviceDayLabel(s.date)}${s.date === today ? " (so far)" : ""}: ${s.verdict?.label ?? ""}, ${s.summary.on_time_pct.toFixed(1)}% on time`}
                      className={cn(
                        "block w-full hover:opacity-80",
                        s.verdict?.barClass ?? "bg-at-muted",
                        s.date === today && "opacity-60",
                      )}
                      style={{ height: `${plotHeight(s.summary.on_time_pct)}%` }}
                    />
                  )}
                  {s.kind === "empty" && (
                    <div className="h-1 w-full border-t border-dashed border-at-muted" />
                  )}
                </div>
              ))}
            </div>
            {/* The guides again over the columns, in white: invisible on the white
                ground, where the grey copy behind shows, and visible across a
                column, so each column reads against its band's floor. */}
            {guides.map((b) => (
              <div
                key={b.label}
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/70"
                style={{ bottom: `${plotHeight(b.floor)}%` }}
              />
            ))}
          </div>
          <div className="mt-1 flex gap-px sm:gap-1">
            {slots.map((s, i) => (
              <div key={s.date} className="min-w-0 flex-1">
                <ColumnLabel slot={s} monthView={monthView} first={i === 0} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
