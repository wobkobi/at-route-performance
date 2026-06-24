import { PunctualityStat, type PunctualityBreakdown } from "@/components/PunctualityStat";
import { formatDuration } from "@/lib/format";
import type { FleetSummary as FleetSummaryData } from "@/types/dashboard";
import type { JSX } from "react";

/** Props for {@link FleetSummary}. */
export interface FleetSummaryProps {
  /** Aggregated totals for the window. */
  data: FleetSummaryData;
}

/**
 * Render the fleet KPI strip (trips, on-time %, average off-schedule, routes).
 * The on-time and "off by" cards open a punctuality breakdown on click, so the
 * near-zero net average no longer looks at odds with the on-time share.
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
      <div className="grid grid-cols-2 sm:grid-cols-4">
        <div className="p-3">
          <div className={labelClass}>Trips</div>
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
          <div className={labelClass}>Routes</div>
          <div className={valueClass}>{data.route_count.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}
