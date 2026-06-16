import { cn } from "@/lib/cn";
import { formatDelay } from "@/lib/format";
import type { FleetSummary as FleetSummaryData } from "@/types/dashboard";
import type { JSX } from "react";

/** Props for {@link FleetSummary}. */
export interface FleetSummaryProps {
  /** Aggregated totals for the window. */
  data: FleetSummaryData;
}

/**
 * Render the fleet KPI strip (trips, on-time %, average delay, routes).
 * @param props - Component props.
 * @param props.data - Aggregated totals for the window.
 * @returns The KPI strip element.
 */
export function FleetSummary({ data }: FleetSummaryProps): JSX.Element {
  const items: { label: string; value: string }[] = [
    { label: "Trips", value: data.events.toLocaleString() },
    {
      label: "On-time",
      value: data.on_time_pct === null ? "—" : `${data.on_time_pct.toFixed(1)}%`,
    },
    {
      label: "Avg delay",
      value: data.avg_delay_sec === null ? "—" : formatDelay(data.avg_delay_sec),
    },
    { label: "Routes", value: data.route_count.toLocaleString() },
  ];
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4")}>
      {items.map((it) => (
        <div key={it.label} className={cn("rounded-xl bg-at-surface p-3 shadow-sm")}>
          <div className={cn("text-xs tracking-zero text-at-muted uppercase")}>{it.label}</div>
          <div className={cn("text-xl font-ultra tracking-zero")}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}
