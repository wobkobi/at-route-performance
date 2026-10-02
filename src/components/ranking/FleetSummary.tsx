// src/components/ranking/FleetSummary.tsx
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
import { SchoolAdded } from "@/components/SchoolAdded";
import { SplitBar } from "@/components/SplitBar";
import { cn } from "@/lib/cn";
import { formatCount, formatDuration, formatPct, UNKNOWN_VALUE } from "@/lib/format";
import type { SchoolDelta } from "@/lib/school-bus";
import { dayVerdict, LEAN_PHRASE, VERDICT_BANDS, verdictLean } from "@/lib/verdict";
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
  /**
   * How much the School buses filter added to each count, marked "+N" beside
   * it. Omitted, or null, while school services are left out.
   */
  schoolAdded?: SchoolDelta | null;
}

const LABEL_CLASS = "at-eyebrow text-at-muted";

/**
 * The scale itself, listed under the on-time popover's footnote so the word
 * on the page is explained where the share behind it is.
 * @returns The scale list.
 */
function VerdictScale(): JSX.Element {
  return (
    <div className="mt-2 border-t border-at-border pt-2 text-xs">
      <p className="at-eyebrow text-at-muted">The verdict</p>
      <ul className="mt-1 space-y-0.5">
        {VERDICT_BANDS.map((b, i) => (
          <li key={b.label} className="flex justify-between gap-2">
            <span className={cn("font-semibold", b.toneClass)}>{b.label}</span>
            <span className="text-at-muted tabular-nums">
              {i === 0
                ? `${b.floor}% or more`
                : b.floor === 0
                  ? `under ${VERDICT_BANDS[i - 1]!.floor}%`
                  : `${b.floor} to ${VERDICT_BANDS[i - 1]!.floor}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The verdict panel: the word, the count and average it sits on, and the
 * three-band bar the word is read off. A window with no on-time share prints no
 * word, no bar, and says which kind of nothing it was.
 *
 * The panel shares the strip's four-column grid from `lg:` up, the word over the
 * first two columns and the sentence over the last two, so the sentence starts
 * on the same line as the third figure below it, with the bar across all four
 * beneath them. Stacked, the largest element on the site left two thirds of its
 * own width empty; pushed to the far right, the sentence floated with nothing
 * tying it back to the word it describes.
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
  const lean = band ? verdictLean(data.early_pct, data.late_pct) : null;
  // All three shares or none: they are one aggregation's output, and a bar drawn
  // from two of them would be short by the missing band and read as a bar that
  // does not add up.
  const split =
    data.on_time_pct !== null && data.late_pct !== null && data.early_pct !== null
      ? { onTime: data.on_time_pct, late: data.late_pct, early: data.early_pct }
      : null;
  return (
    <div className="grid gap-x-6 gap-y-5 pb-6 lg:grid-cols-4 lg:items-end">
      <div className="min-w-0 lg:col-span-2">
        {/* Positioned, so the on-time popover drops from this row rather than from
            the foot of the whole panel. */}
        <div className={cn("relative flex items-center gap-1", LABEL_CLASS)}>
          Verdict
          <PunctualityInfo
            label="On time"
            breakdown={breakdown}
            variant="split"
            extra={<VerdictScale />}
          />
        </div>
        {/* One step down from the page's own h1: the question is the heading and
            this is its answer, so the two read as a pair rather than as two
            headlines competing at different sizes. */}
        <p
          className={cn(
            "mt-1 text-4xl leading-headline font-ultra tracking-zero sm:text-5xl",
            band?.toneClass ?? "text-at-muted",
          )}
        >
          {band?.label ?? UNKNOWN_VALUE}
        </p>
        {/* The word is one share of arrivals and hides which side missed: a day
            of buses leaving early and a day of buses stuck late score alike. */}
        {lean && (
          <p
            className={cn(
              "mt-1 text-lg font-semibold",
              lean === "early"
                ? "text-at-early-strong"
                : lean === "late"
                  ? "text-at-late"
                  : "text-at-muted",
            )}
          >
            {LEAN_PHRASE[lean]}
          </p>
        )}
      </div>
      <div className="lg:col-span-2 lg:max-w-sm">
        {/* The arrivals count and the shares below have different denominators on
            purpose: arrivals include readings the nightly ghost pass hid, and
            every rate divides by the real ones (see lib/cron/aggregate.ts). "X% of N
            arrivals" welded them into one claim neither number supports, so the
            count is stated here and the shares are read off the bar. */}
        <p className="text-sm text-at-muted">
          {data.on_time_pct === null
            ? // Zero arrivals and too few measured ones both leave the share null,
              // and the verdict reads the same blank either way. Which one it was
              // is the difference between a quiet window and an unmeasurable one.
              data.events === 0
              ? "No arrivals were recorded, so there is no verdict to give."
              : "Too few measured arrivals for a verdict."
            : `${formatCount(data.events)} arrivals` +
              (data.avg_abs_delay_sec === null
                ? ""
                : `, avg off by ${formatDuration(data.avg_abs_delay_sec)}`)}
        </p>
      </div>
      {split && <SplitBar {...split} mode={breakdown.mode} />}
    </div>
  );
}

/**
 * Render the fleet KPI strip (arrivals, on-time share, average off-schedule, routes).
 * The on-time and "off by" cards open a punctuality breakdown on click, so a
 * near-zero net average does not look at odds with the on-time share. With
 * `verdict`, the on-time share leads as a word above the other four figures,
 * which sit two by two on a phone.
 * @param props - Component props.
 * @param props.data - Aggregated totals for the window.
 * @param props.verdict - Lead with the verdict panel.
 * @param props.schoolAdded - How much including school services added to each count.
 * @returns The KPI strip element.
 */
export function FleetSummary({
  data,
  verdict = false,
  schoolAdded = null,
}: FleetSummaryProps): JSX.Element {
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

  // With the verdict, this is the home page's own band: no box, a hairline under
  // the verdict, and figures large enough to be read across the row. Without it,
  // the strip is still a bordered box on the pages that have not been rebuilt.
  const cell = verdict ? undefined : "p-3";
  // The home figures grow with the box gone; a bordered strip keeps its own
  // scale so its cells stay level with PunctualityStat's `sm` siblings.
  const valueClass = cn("at-figure", verdict ? "text-2xl sm:text-3xl" : "text-xl");
  return (
    <div className={verdict ? undefined : "at-card"}>
      {verdict && <VerdictPanel data={data} breakdown={breakdown} />}
      <div
        className={cn(
          "grid grid-cols-2",
          verdict
            ? "gap-x-6 gap-y-5 border-t border-at-border pt-5 lg:grid-cols-4"
            : "sm:grid-cols-3 lg:grid-cols-5",
        )}
      >
        <div className={cell}>
          <div className={LABEL_CLASS}>Arrivals</div>
          <div className={valueClass}>
            {formatCount(data.events)}
            <SchoolAdded n={schoolAdded?.events} />
          </div>
        </div>
        {!verdict && (
          <PunctualityStat
            bare
            size="sm"
            variant="split"
            label="On time"
            value={formatPct(data.on_time_pct)}
            breakdown={breakdown}
          />
        )}
        <PunctualityStat
          bare
          size={verdict ? "md" : "sm"}
          variant="average"
          label="Avg off by"
          value={
            data.avg_abs_delay_sec === null ? UNKNOWN_VALUE : formatDuration(data.avg_abs_delay_sec)
          }
          breakdown={breakdown}
        />
        <div className={cell}>
          {/* One name with /cancellations, which counts the same flagged trips.
              The count is of AT's flags, not of trips that failed to run, so the
              note is part of the figure rather than a footnote to it. */}
          <div className={LABEL_CLASS}>Flagged cancelled</div>
          <div className={cn(valueClass, data.cancelled ? "text-at-late" : undefined)}>
            {data.cancelled === null ? UNKNOWN_VALUE : formatCount(data.cancelled)}
            <SchoolAdded n={schoolAdded?.cancelled} />
          </div>
          <div className="text-xs text-at-muted">Reinstated trips included</div>
        </div>
        <div className={cell}>
          <div className={LABEL_CLASS}>Routes</div>
          <div className={valueClass}>
            {formatCount(data.route_count)}
            <SchoolAdded n={schoolAdded?.route_count} />
          </div>
        </div>
      </div>
      {/* A route with cancellations but no arrivals still counts under Routes, so
          the strip can read a real 0 beside four dashes - and a filter that
          leaves only such routes makes that the whole strip. The dashes mean
          there is nothing to measure, not that the measurement is missing.
          Only without the verdict panel, whose own sentence says it already. */}
      {!verdict && data.events === 0 && (
        <p className="border-t border-at-border p-3 text-sm text-at-muted">
          {data.route_count === 0
            ? "No routes match, so there is nothing to summarise."
            : "None of these routes recorded an arrival, so the punctuality figures are blank rather than zero."}
        </p>
      )}
    </div>
  );
}
