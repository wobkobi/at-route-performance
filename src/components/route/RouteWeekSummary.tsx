// src/components/route/RouteWeekSummary.tsx
// Render a route's per-day on-time summary for a week window.
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { formatCount, formatPct, offScheduleValue } from "@/lib/format";
import { serviceDayLabel } from "@/lib/time/service-day";
import type { RouteDay } from "@/types/api";
import Link from "next/link";
import type { JSX } from "react";

/**
 * Compact per-day history table for a single route: each service day's event
 * count, average delay and on-time percentage, the current day included. When
 * the window holds no arrivals the section stays, with a line saying so, so the
 * week view never shows a bare heading over nothing.
 * @param props - Component props.
 * @param props.days - Per-day stats, newest first (from `getRouteDailyStats`).
 * @param props.mode - Route mode for the per-mode delay colour banding.
 * @param props.label - Section heading (defaults to "Last 7 days").
 * @param props.dayHref - The route's own page for one of the days.
 * @returns The summary table, or the empty-state section.
 */
export function RouteWeekSummary({
  days,
  mode,
  label = "Last 7 days",
  dayHref,
}: {
  days: RouteDay[];
  mode: string;
  label?: string;
  dayHref: (date: string) => string;
}): JSX.Element {
  if (days.length === 0) {
    return (
      <Panel>
        <SectionHeading className="border-b border-at-border px-4 py-3">{label}</SectionHeading>
        <EmptyState inset className="px-4 py-6">
          No arrivals were recorded for this route in this period.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel>
      <SectionHeading className="border-b border-at-border px-4 py-3">{label}</SectionHeading>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="at-th-row bg-at-shore-pale">
              <th scope="col" className="px-4 py-2">
                Date
              </th>
              <th scope="col" className="px-4 py-2 text-right">
                Arrivals
              </th>
              <th scope="col" className="px-4 py-2 text-right">
                Early or late
              </th>
              <th scope="col" className="px-4 py-2 text-right">
                On time
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date} className="border-t border-at-border">
                <td className="px-4 py-2 tabular-nums">
                  <Link href={dayHref(day.date)} className="at-link">
                    {serviceDayLabel(day.date)}
                  </Link>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCount(day.events)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {offScheduleValue(day.avg_delay_sec, null, mode).text}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatPct(day.on_time_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
