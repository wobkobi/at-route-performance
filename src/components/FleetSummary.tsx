// src/components/FleetSummary.tsx
// Render the fleet KPI strip of arrivals, on-time %, average
// off-schedule, cancellations, and routes. The arrivals count is stop arrivals,
// not trips: one trip contributes one ArrivalEvent per stop it serves, so
// labelling it "trips" overstates it by the route's stop count. The cancelled
// count is of flagged trips; their effect on the percentages is already in the
// rows, as the wait for the next trip (lib/rider-wait.ts).

import {
  PunctualityInfo,
  PunctualityStat,
  type PunctualityBreakdown,
} from "@/components/PunctualityStat";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { VERDICT_BANDS, dayVerdict, verdictIndex } from "@/lib/verdict";
import type { FleetSummary as FleetSummaryData } from "@/types/dashboard";
import type { JSX } from "react";

/** Props for {@link FleetSummary}. */
export interface FleetSummaryProps {
  /** Aggregated totals for the window. */
  data: FleetSummaryData;
  /**
   * Lead with a one-word verdict on the on-time share, which then moves out of
   * the strip into the verdict panel. Off by default, so the Routes page keeps
   * the plain five-cell strip.
   */
  verdict?: boolean;
}

const LABEL_CLASS = "text-xs tracking-zero text-at-muted uppercase";
const VALUE_CLASS = "text-xl font-ultra tracking-zero";

/**
 * The scale itself, listed under the on-time popover's footnote so the word
 * on the page is explained where the share behind it is.
 * @returns The scale list.
 */
function VerdictScale(): JSX.Element {
  return (
    <div className="mt-2 border-t border-at-border pt-2 text-xs">
      <p className="font-semibold tracking-zero text-at-muted uppercase">The verdict</p>
      <ul className="mt-1 space-y-0.5">
        {VERDICT_BANDS.map((b, i) => (
          <li key={b.label} className="flex justify-between gap-2">
            <span className={cn("font-semibold", b.toneClass)}>{b.label}</span>
            <span className="text-at-muted tabular-nums">
              {i === 0
                ? `${b.floor}% or more`
                : b.floor === 0
                  ? `under ${VERDICT_BANDS[i - 1]!.floor}%`
                  : `${b.floor}-${VERDICT_BANDS[i - 1]!.floor}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The verdict panel: the word, a five-rung meter, and the sentence the word is
 * built from. A window with no on-time share prints no word, a grey meter and
 * says so.
 * @param props - Component props.
 * @param props.data - Aggregated totals for the window.
 * @param props.breakdown - The on-time split behind the popover.
 * @returns The panel.
 */
function VerdictPanel({
  data,
  breakdown,
}: {
  data: FleetSummaryData;
  breakdown: PunctualityBreakdown;
}): JSX.Element {
  const band = dayVerdict(data.on_time_pct);
  const rung = verdictIndex(band);
  const rungs = VERDICT_BANDS.length;
  return (
    <div className="space-y-3 border-b border-at-border p-4">
      {/* Positioned, so the on-time popover drops from this row rather than from
          the foot of the whole panel. */}
      <div className={cn("relative flex items-center gap-1", LABEL_CLASS)}>
        Verdict
        <PunctualityInfo
          label="On-time"
          breakdown={breakdown}
          variant="split"
          extra={<VerdictScale />}
        />
      </div>
      <p
        className={cn(
          "text-5xl font-ultra tracking-zero sm:text-6xl",
          band?.toneClass ?? "text-at-muted",
        )}
      >
        {band?.label ?? "—"}
      </p>
      <div
        role="img"
        aria-label={band ? `${band.label}, ${rung + 1} of ${rungs}` : "No verdict"}
        className="flex h-2 max-w-xs gap-1"
      >
        {Array.from({ length: rungs }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "flex-1 rounded-full",
              band && i <= rung ? band.barClass : "bg-at-border",
            )}
          />
        ))}
      </div>
      {/* The count and the percentage have different denominators on purpose:
          arrivals include readings the nightly ghost pass hid, and every rate
          divides by the real ones (see aggregate.ts). "X% of N arrivals" welded
          them into one claim neither number supports, so they are listed. */}
      <p className="text-sm text-at-muted">
        {data.on_time_pct === null
          ? "Not enough data"
          : `${data.events.toLocaleString()} arrivals, ${data.on_time_pct.toFixed(1)}% of those measured on time` +
            (data.avg_abs_delay_sec === null
              ? ""
              : `, ${formatDuration(data.avg_abs_delay_sec)} off on average`)}
      </p>
    </div>
  );
}

/**
 * Render the fleet KPI strip (arrivals, on-time %, average off-schedule, routes).
 * The on-time and "off by" cards open a punctuality breakdown on click, so a
 * near-zero net average does not look at odds with the on-time share. With
 * `verdict`, the on-time share leads as a word above the other four figures,
 * which sit two by two on a phone.
 * @param props - Component props.
 * @param props.data - Aggregated totals for the window.
 * @param props.verdict - Lead with the verdict panel.
 * @returns The KPI strip element.
 */
export function FleetSummary({ data, verdict = false }: FleetSummaryProps): JSX.Element {
  const breakdown: PunctualityBreakdown = {
    on_time_pct: data.on_time_pct,
    early_pct: data.early_pct,
    late_pct: data.late_pct,
    avg_delay_sec: data.avg_delay_sec,
    avg_abs_delay_sec: data.avg_abs_delay_sec,
    // The rankings rows these totals come from have already been through
    // applyRoutePenalties.
    cancellations: "counted",
  };

  return (
    <div className="border border-at-border bg-at-surface">
      {verdict && <VerdictPanel data={data} breakdown={breakdown} />}
      <div
        className={cn(
          "grid grid-cols-2",
          verdict ? "lg:grid-cols-4" : "sm:grid-cols-3 lg:grid-cols-5",
        )}
      >
        <div className="p-3">
          <div className={LABEL_CLASS}>Arrivals</div>
          <div className={VALUE_CLASS}>{data.events.toLocaleString()}</div>
        </div>
        {!verdict && (
          <PunctualityStat
            bare
            size="sm"
            variant="split"
            label="On-time"
            value={data.on_time_pct === null ? "—" : `${data.on_time_pct.toFixed(1)}%`}
            breakdown={breakdown}
          />
        )}
        <PunctualityStat
          bare
          size="sm"
          variant="average"
          label="Avg off by"
          value={data.avg_abs_delay_sec === null ? "—" : formatDuration(data.avg_abs_delay_sec)}
          breakdown={breakdown}
        />
        <div className="p-3">
          {/* One name with /cancellations, which counts the same flagged trips.
              The count is of AT's flags, not of trips that failed to run, so the
              note is part of the figure rather than a footnote to it. */}
          <div className={LABEL_CLASS}>Flagged cancelled</div>
          <div className={cn(VALUE_CLASS, data.cancelled ? "text-at-late" : undefined)}>
            {data.cancelled === null ? "—" : data.cancelled.toLocaleString()}
          </div>
          <div className="text-xs text-at-muted">Reinstated trips included</div>
        </div>
        <div className="p-3">
          <div className={LABEL_CLASS}>Routes</div>
          <div className={VALUE_CLASS}>{data.route_count.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}
