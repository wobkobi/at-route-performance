"use client";
// src/components/PunctualityStat.tsx
/**
 * @description Render a punctuality breakdown of early, on-time, and late share bars.
 */

import { cn } from "@/lib/cn";
import { formatDelay, formatDuration } from "@/lib/format";
import { earlyToleranceFor, ON_TIME_LATE_SEC } from "@/lib/on-time";
import { useState, type JSX } from "react";

/**
 * CSS width for a share-bar segment from a percentage (clamped at 0).
 * @param pct - The band percentage, or null.
 * @returns A CSS width string.
 */
function barWidth(pct: number | null): string {
  return `${Math.max(0, pct ?? 0)}%`;
}

/** The on-time split + averages behind a punctuality KPI. */
export interface PunctualityBreakdown {
  on_time_pct: number | null;
  early_pct: number | null;
  late_pct: number | null;
  /** Signed (net) average deviation in seconds. */
  avg_delay_sec: number | null;
  /** Average absolute deviation in seconds (the "off by" magnitude). */
  avg_abs_delay_sec: number | null;
  /** Route mode for the net-average "on time" wording (omit for the fleet). */
  mode?: string;
}

/** Props for {@link PunctualityStat}. */
export interface PunctualityStatProps {
  /** KPI caption, e.g. "On-time" or "Avg off by". */
  label: string;
  /** Pre-formatted KPI value. */
  value: string;
  /** Numbers shown in the click-to-open breakdown. */
  breakdown: PunctualityBreakdown;
  /**
   * Which detail to reveal: `split` shows the on-time/early/late share (for the
   * On-time card); `average` contrasts the net average with the "off by"
   * magnitude (for the Avg-off-by card). Keeps the two heroes' popovers distinct.
   */
  variant: "split" | "average";
  /** Card size: `lg` for the route page heroes, `sm` for the home KPI strip. */
  size?: "sm" | "lg";
  /** Drop the card's own border so it can sit inside a shared KPI box. */
  bare?: boolean;
}

/**
 * Describe the on-time window for the popover footnote. Ferry uses a symmetric
 * window; all other modes (and the fleet/stop strip, which passes no mode) use
 * the asymmetric bus/train window.
 * @param mode - Route mode from `PunctualityBreakdown.mode`, or undefined.
 * @returns A plain-English description of the window.
 */
function onTimeWindowDescription(mode: string | undefined): string {
  const earlyMin = Math.round(earlyToleranceFor(mode ?? "") / 60);
  const lateMin = Math.round(ON_TIME_LATE_SEC / 60);
  const window =
    earlyMin === lateMin
      ? `within ${lateMin} min either side`
      : `${earlyMin} min early to ${lateMin} min late`;
  return `On time means ${window}. Early and late are both off-schedule.`;
}

/**
 * A breakdown row: a coloured swatch, a label, and a percentage.
 * @param root0 - Row props.
 * @param root0.colour - Tailwind background class for the swatch.
 * @param root0.label - Band name.
 * @param root0.pct - Percentage, or null when unknown.
 * @returns The row element.
 */
function BandRow({
  colour,
  label,
  pct,
}: {
  colour: string;
  label: string;
  pct: number | null;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", colour)} />
      <span className="flex-1 text-at-muted">{label}</span>
      <span className="font-semibold tabular-nums">{pct == null ? "—" : `${pct}%`}</span>
    </div>
  );
}

/**
 * A KPI card that opens a punctuality breakdown on click - the on-time / early /
 * late split plus the net average and the average "off by". Explains why a high
 * off-schedule share can sit beside a near-zero net average (earlies and lates
 * cancel). Other (non-punctuality) KPIs stay plain.
 * @param props - Component props.
 * @param props.label - KPI caption.
 * @param props.value - Pre-formatted KPI value.
 * @param props.breakdown - The on-time split + averages.
 * @param props.variant - Which detail to reveal (`split` or `average`).
 * @param props.size - Card size (`lg` route heroes, `sm` home strip).
 * @param props.bare - Drop the card's own border (for a shared KPI box).
 * @returns The clickable KPI card with its popover.
 */
export function PunctualityStat({
  label,
  value,
  breakdown,
  variant,
  size = "lg",
  bare = false,
}: PunctualityStatProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const { on_time_pct, early_pct, late_pct, avg_delay_sec, avg_abs_delay_sec, mode } = breakdown;

  return (
    <div
      className={cn(
        "relative bg-at-surface",
        bare ? "" : "border border-at-border",
        size === "lg" ? "p-4" : "p-3",
      )}
    >
      {/* Card text stays plain (selectable); only the info button opens the popover. */}
      <span className="flex items-center gap-1 text-xs tracking-zero text-at-muted uppercase">
        {label}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${label} breakdown`}
          className="cursor-pointer text-at-muted transition-colors hover:text-at-ink"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
            <path d="M8 1.5A6.5 6.5 0 1 0 8 14.5 6.5 6.5 0 0 0 8 1.5Zm.8 9.7H7.2V7h1.6Zm0-5.2H7.2V4.8h1.6Z" />
          </svg>
        </button>
      </span>
      <span
        className={cn(
          "block font-ultra tracking-zero tabular-nums",
          size === "lg" ? "text-2xl" : "text-xl",
        )}
      >
        {value}
      </span>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute top-full left-0 z-20 mt-1 w-64 rounded-md border border-at-border bg-at-surface p-3 shadow-lg">
            {variant === "split" ? (
              <>
                <p className="text-xs font-semibold tracking-zero text-at-muted uppercase">
                  Of all arrivals
                </p>
                {/* Stacked share bar: on time / late / early. */}
                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-at-bg">
                  <span className="bg-at-ontime" style={{ width: barWidth(on_time_pct) }} />
                  <span className="bg-at-late" style={{ width: barWidth(late_pct) }} />
                  <span className="bg-at-early" style={{ width: barWidth(early_pct) }} />
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  <BandRow colour="bg-at-ontime" label="On time" pct={on_time_pct} />
                  <BandRow colour="bg-at-late" label="Late" pct={late_pct} />
                  <BandRow colour="bg-at-early" label="Early" pct={early_pct} />
                </div>
                <p className="mt-2 text-xs leading-snug text-at-muted">
                  {onTimeWindowDescription(mode)}
                </p>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold tracking-zero text-at-muted uppercase">
                  Average delay
                </p>
                <div className="mt-2 space-y-1 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-at-muted">Net (early + late)</span>
                    <span className="font-semibold tabular-nums">
                      {avg_delay_sec == null
                        ? "—"
                        : formatDelay(avg_delay_sec, mode ? { mode } : {})}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-at-muted">Off by (magnitude)</span>
                    <span className="font-semibold tabular-nums">
                      {avg_abs_delay_sec == null ? "—" : formatDuration(avg_abs_delay_sec)}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-snug text-at-muted">
                  Earlies and lates cancel in the net average, so it nears zero even when many runs
                  are off. &ldquo;Off by&rdquo; ignores direction - the typical distance from
                  schedule.
                </p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
