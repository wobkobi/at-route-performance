// src/components/FleetSummary.tsx
/**
 * @description Render the fleet KPI strip of arrivals, on-time %, average
 * off-schedule, cancellations, and routes. The arrivals count is stop arrivals,
 * not trips: one trip contributes one ArrivalEvent per stop it serves, so
 * labelling it "trips" overstates it by the route's stop count. Cancellations
 * sit beside the percentages rather than inside them - a cancelled trip records
 * no arrival, so it cannot appear in an on-time rate at all.
 */
import { PunctualityStat, type PunctualityBreakdown } from "@/components/PunctualityStat";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import type { FleetSummary as FleetSummaryData } from "@/types/dashboard";
import type { JSX } from "react";

/** Props for {@link FleetSummary}. */
export interface FleetSummaryProps {
  /** Aggregated totals for the window. */
  data: FleetSummaryData;
}

/**
 * Render the fleet KPI strip (arrivals, on-time %, average off-schedule, routes).
 * The on-time and "off by" cards open a punctuality breakdown on click, so a
 * near-zero net average does not look at odds with the on-time share.
 * @param props - Component props.
 * @param props.data - Aggregated totals for the window.
 * @returns The KPI strip element.
 */
export function FleetSummary({ data }: FleetSummaryProps): JSX.Element {
  const breakdown: PunctualityBreakdown = {
    on_time_pct: data.on_time_pct,
    early_pct: data.early_pct,
    late_pct: data.late_pct,
    avg_delay_sec: data.avg_delay_sec,
    avg_abs_delay_sec: data.avg_abs_delay_sec,
  };
  const labelClass = "text-xs tracking-zero text-at-muted uppercase";
  const valueClass = "text-xl font-ultra tracking-zero";

  return (
    <div className="border border-at-border bg-at-surface">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        <div className="p-3">
          <div className={labelClass}>Arrivals</div>
          <div className={valueClass}>{data.events.toLocaleString()}</div>
        </div>
        <PunctualityStat
          bare
          size="sm"
          variant="split"
          label="On-time"
          value={data.on_time_pct === null ? "—" : `${data.on_time_pct.toFixed(1)}%`}
          breakdown={breakdown}
        />
        <PunctualityStat
          bare
          size="sm"
          variant="average"
          label="Avg off by"
          value={data.avg_abs_delay_sec === null ? "—" : formatDuration(data.avg_abs_delay_sec)}
          breakdown={breakdown}
        />
        <div className="p-3">
          <div className={labelClass}>Cancelled</div>
          <div className={cn(valueClass, data.cancelled ? "text-at-late" : undefined)}>
            {data.cancelled === null ? "—" : data.cancelled.toLocaleString()}
          </div>
        </div>
        <div className="p-3">
          <div className={labelClass}>Routes</div>
          <div className={valueClass}>{data.route_count.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}
