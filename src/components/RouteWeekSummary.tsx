import { formatDelay } from "@/lib/format";
import type { RouteDay } from "@/types/api";
import type { JSX } from "react";

/**
 * Format a `YYYY-MM-DD` service date as `DD/MM`.
 * @param iso - The service date.
 * @returns Short date like "24/06".
 */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/**
 * Compact per-day history table for a single route. Pulls from `DailyRouteSummary`
 * records and shows each completed service day's event count, average delay, and
 * on-time percentage. Renders nothing when no summary records exist yet.
 * @param props - Component props.
 * @param props.days - Per-day stats, newest first (from `getRouteDailyStats`).
 * @param props.mode - Route mode for the per-mode delay colour banding.
 * @param props.label - Section heading (defaults to "Last 7 days").
 * @returns The summary table, or null when there are no days.
 */
export function RouteWeekSummary({
  days,
  mode,
  label = "Last 7 days",
}: {
  days: RouteDay[];
  mode: string;
  label?: string;
}): JSX.Element | null {
  if (days.length === 0) return null;

  return (
    <section className="border border-at-border bg-at-surface">
      <h2 className="border-b border-at-border px-4 py-3 text-lg font-ultra tracking-zero">
        {label}
      </h2>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-at-bg text-left text-xs tracking-zero text-at-muted uppercase">
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2 text-right">Events</th>
              <th className="px-4 py-2 text-right">Avg delay</th>
              <th className="px-4 py-2 text-right">On time</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date} className="border-t border-at-border">
                <td className="px-4 py-2 text-at-muted tabular-nums">{shortDate(day.date)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{day.events}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {day.avg_delay_sec == null ? "—" : formatDelay(day.avg_delay_sec, { mode })}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {day.on_time_pct == null ? "—" : `${day.on_time_pct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
