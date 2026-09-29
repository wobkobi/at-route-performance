"use client";
// src/components/PunctualityStat.tsx
// Render a punctuality breakdown of early, on-time, and late share bars.

import { cn } from "@/lib/cn";
import { onTimeWindowSentence } from "@/lib/copy";
import { formatDelay, formatDuration, UNKNOWN_VALUE } from "@/lib/format";
import {
  CANCELLED_EXCLUDED_COPY,
  CANCELLED_SPLIT_COPY,
  type CancellationBasis,
} from "@/lib/on-time";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/**
 * CSS width for a share-bar segment from a percentage (clamped at 0).
 * @param pct - The band percentage, or null.
 * @returns A CSS width string.
 */
function barWidth(pct: number | null): string {
  return `${Math.max(0, pct ?? 0)}%`;
}

/**
 * Percentage text for a band row, or the placeholder when it is unknown.
 * @param pct - The band percentage, or null.
 * @returns The text for the row's value.
 */
function pctText(pct: number | null): string {
  return pct == null ? UNKNOWN_VALUE : `${pct}%`;
}

/** The average "off by" magnitude split into the two sides it is built from. */
interface OffBySplit {
  /** Signed (net) average deviation in seconds, the two sides subtracted. */
  net: number;
  /** Average absolute deviation in seconds, the two sides added. */
  magnitude: number;
  /** Seconds of lateness per arrival. */
  late: number;
  /** Seconds of earliness per arrival. */
  early: number;
  /** The late side's share of the magnitude, for the bar. */
  latePct: number;
  /** The early side's share, for the bar. */
  earlyPct: number;
}

/**
 * Split the average "off by" magnitude into the lateness and the earliness it is
 * built from, per arrival.
 *
 * Exact rather than estimated, and it needs nothing beyond the two means already
 * stored. Writing `P` for the total of every late-side deviation and `N` for the
 * total of every early-side one over `n` arrivals, the net mean is `(P - N) / n`
 * and the magnitude mean is `(P + N) / n`. Add the two means and halve for
 * `P / n`; subtract and halve for `N / n`. So the halves sum to the magnitude
 * and differ by the net, which is what the rows under the bar show.
 *
 * Sides are the timetable's, not the on-time window's: a run 30 seconds late is
 * inside the window and still counts on the late side.
 * @param net - Signed average deviation in seconds (negative early, positive late), or null.
 * @param magnitude - Average absolute deviation in seconds, or null.
 * @returns The split, or null when either mean is missing.
 */
function offBySplit(net: number | null, magnitude: number | null): OffBySplit | null {
  if (net == null || magnitude == null) return null;
  // Clamped because the two means are computed independently: a pair where the
  // net exceeds the magnitude has no real split, and must not draw as a
  // negative width.
  const late = Math.max(0, (magnitude + net) / 2);
  const early = Math.max(0, (magnitude - net) / 2);
  const total = late + early;
  const latePct = total > 0 ? (late / total) * 100 : 0;
  const earlyPct = total > 0 ? (early / total) * 100 : 0;
  return { net, magnitude, late, early, latePct, earlyPct };
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
  /**
   * Whether the cancellation penalty is inside these percentages. Required, and
   * deliberately not defaulted: the footnote states which it is, and a default
   * would let a surface keep the wrong claim by saying nothing. A part-of-day
   * filter and every stop figure are `"excluded"`; see {@link CANCELLED_SPLIT_COPY}.
   */
  cancellations: CancellationBasis;
}

/** Props for {@link PunctualityStat}. */
export interface PunctualityStatProps {
  /** KPI caption, e.g. "On time" or "Avg off by". */
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
  /**
   * Card size: `lg` for the route page heroes, `sm` for a KPI strip inside a
   * bordered box, `md` for the home strip, whose figures carry the page now that
   * the box around them has gone.
   */
  size?: "sm" | "md" | "lg";
  /** Drop the card's own border so it can sit inside a shared KPI box. */
  bare?: boolean;
}

/**
 * A row under a bar: a coloured swatch matching one of its segments, a label,
 * and that segment's figure.
 * @param root0 - Row props.
 * @param root0.colour - Tailwind background class for the swatch.
 * @param root0.label - Band or side name.
 * @param root0.value - Pre-formatted figure, a share or a duration.
 * @returns The row element.
 */
function BandRow({
  colour,
  label,
  value,
}: {
  colour: string;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", colour)} />
      <span className="flex-1 text-at-muted">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/**
 * A figure the two halves add up to or cancel down to. No swatch: it is not a
 * segment of the bar, so it does not sit under one of its colours.
 * @param root0 - Row props.
 * @param root0.label - What the figure is.
 * @param root0.value - Pre-formatted figure.
 * @returns The row element.
 */
function TotalRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-at-muted">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/**
 * The Avg-off-by popover's body: the card's own figure, then the bar that takes
 * it apart into the lateness and the earliness it is built from (see
 * {@link offBySplit}), then what those two cancel down to.
 *
 * Read top to bottom it is a sentence - off by this much, of which this much
 * late and this much early, which balances out to this - so the rows can be
 * named in a couple of words each and the arithmetic needs no symbols.
 *
 * A bar of shares rather than of the bands the on-time card draws: these two
 * figures are means, so no reading belongs to one bucket or another, and what a
 * reader cannot see from a single average is which way a route misses.
 *
 * Every caller reads both means off one summary row, so they are known together
 * and a missing pair means nothing arrived - which is what the empty state says.
 * @param props - Component props.
 * @param props.net - Signed (net) average deviation in seconds, or null when nothing arrived.
 * @param props.magnitude - Average absolute deviation in seconds, or null when nothing arrived.
 * @returns The popover body.
 */
function AverageDetail({
  net,
  magnitude,
}: {
  net: number | null;
  magnitude: number | null;
}): JSX.Element {
  const split = offBySplit(net, magnitude);
  return (
    <>
      <p className="text-xs font-semibold tracking-zero text-at-muted uppercase">
        Of the typical arrival
      </p>
      {split === null ? (
        <p className="mt-2 text-sm text-at-muted">
          No arrivals in this window, so there is nothing to average.
        </p>
      ) : (
        <>
          {/* Neither total applies the on-time window: a route that runs as early as it runs
              late balances near zero, and "on time" above a magnitude of 9m would contradict it. */}
          <div className="mt-2 text-sm">
            {/* "Off by", the card's own noun, rather than a seventh name for this one metric. */}
            <TotalRow label="Off by" value={formatDuration(split.magnitude)} />
          </div>
          {/* What that figure is made of. The two halves always fill the bar, so its balance
              says which way the typical miss went - not how big it was, which is the figure
              above. Drawn only when there is a miss to split: at zero on both halves an empty
              bar would read as no data rather than as running to the minute. */}
          {split.magnitude > 0 && (
            <div className="mt-2 flex h-2 overflow-hidden bg-at-bg">
              <span className="bg-at-late" style={{ width: barWidth(split.latePct) }} />
              <span className="bg-at-early" style={{ width: barWidth(split.earlyPct) }} />
            </div>
          )}
          <div className="mt-2 space-y-1 text-sm">
            <BandRow
              colour="bg-at-late"
              label="From running late"
              value={formatDuration(split.late)}
            />
            <BandRow
              colour="bg-at-early"
              label="From running early"
              value={formatDuration(split.early)}
            />
          </div>
          <div className="mt-2 text-sm">
            <TotalRow label="On balance" value={formatDelay(split.net, { thresholdSec: 0 })} />
          </div>
          <p className="mt-2 text-xs leading-snug text-at-muted">
            Late plus early makes the off-by figure; late minus early makes the balance.
          </p>
        </>
      )}
    </>
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
 * @param props.size - Card size (`lg` route heroes, `md` the home strip, `sm` inside a bordered strip).
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
  return (
    <div
      className={cn(
        "relative bg-at-surface",
        bare ? "" : "border border-at-border",
        size === "lg" ? "p-4" : size === "md" ? "" : "p-3",
      )}
    >
      {/* Card text stays plain (selectable); only the info button opens the popover. */}
      <div className="at-eyebrow flex items-center gap-1 text-at-muted">
        {label}
        <PunctualityInfo label={label} breakdown={breakdown} variant={variant} />
      </div>
      <span
        className={cn(
          "at-figure block",
          size === "lg" ? "text-2xl" : size === "md" ? "text-2xl sm:text-3xl" : "text-xl",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Props for {@link PunctualityInfo}. */
export interface PunctualityInfoProps {
  /** Caption the button and popover are named after. */
  label: string;
  /** Numbers shown in the popover. */
  breakdown: PunctualityBreakdown;
  /** Which detail to reveal; see {@link PunctualityStatProps.variant}. */
  variant: "split" | "average";
  /** Extra content under the split's footnote, such as the verdict scale. */
  extra?: ReactNode;
}

/**
 * The info button and the breakdown popover it opens. The popover anchors to
 * the nearest positioned ancestor, so the caller decides where it drops from by
 * making that container `relative`.
 * @param props - Component props.
 * @param props.label - Caption the button and popover are named after.
 * @param props.breakdown - The on-time split + averages.
 * @param props.variant - Which detail to reveal (`split` or `average`).
 * @param props.extra - Extra content under the split's footnote.
 * @returns The button and, while open, the popover.
 */
export function PunctualityInfo({
  label,
  breakdown,
  variant,
  extra,
}: PunctualityInfoProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const {
    on_time_pct,
    early_pct,
    late_pct,
    avg_delay_sec,
    avg_abs_delay_sec,
    mode,
    cancellations,
  } = breakdown;
  const popoverId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  /** Close the popover and hand focus back to the button that opened it. */
  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  // Leaving the page no longer unmounts it: a route navigated away from is held
  // hidden, so an open popover would still be open on the way back, over figures
  // the reader never asked it about. Effects are torn down when the route hides,
  // so closing from a cleanup catches it. `setOpen` rather than `close`, because
  // moving focus to a hidden button would take it off the page being opened.
  useEffect(() => {
    if (!open) return;
    return () => setOpen(false);
  }, [open]);

  /**
   * Close on Escape from the button or from inside the popover.
   * @param e - The key event.
   */
  const onKeyDown = (e: KeyboardEvent): void => {
    if (open && e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onKeyDown}
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label={`${label} breakdown`}
        className="cursor-pointer text-at-muted transition-colors hover:text-at-ink"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
          <path d="M8 1.5A6.5 6.5 0 1 0 8 14.5 6.5 6.5 0 0 0 8 1.5Zm.8 9.7H7.2V7h1.6Zm0-5.2H7.2V4.8h1.6Z" />
        </svg>
      </button>

      {open && (
        <>
          {/* `pointerdown`, not `click`: a tap on a plain div does not reliably
              raise a click on iOS Safari, which left the popover with no way to
              dismiss it on the device it most crowds. Sits under the popover
              and over the sticky header, which is `z-40`. */}
          <div className="fixed inset-0 z-40" onPointerDown={close} aria-hidden />
          <div
            id={popoverId}
            role="group"
            aria-label={`${label} breakdown`}
            onKeyDown={onKeyDown}
            /* A phone gets a sheet across the bottom of the viewport rather than
               a 256px panel anchored to the card: anchored, a right-hand KPI
               pushes most of it off screen, and there is nowhere on a 390px
               viewport for it to flip to. From `sm` up it is the anchored panel. */
            className="fixed inset-x-3 bottom-3 z-50 rounded-md border border-at-border bg-at-surface p-3 text-left text-at-ink normal-case shadow-lg sm:absolute sm:inset-x-auto sm:top-full sm:bottom-auto sm:left-0 sm:mt-1 sm:w-64"
          >
            {variant === "split" ? (
              <>
                <p className="text-xs font-semibold tracking-zero text-at-muted uppercase">
                  Of all arrivals
                </p>
                {on_time_pct == null ? (
                  /* An unknown share used to clamp to 0% and draw the bar empty,
                     which reads as nothing having arrived on time rather than as
                     nothing being known - the graphic said catastrophe while the
                     rows beside it said "—". Say it in words instead. */
                  <p className="mt-2 text-sm text-at-muted">
                    No arrivals in this window, so there is no split to show.
                  </p>
                ) : (
                  <>
                    {/* Stacked share bar: on time / late / early. */}
                    <div className="mt-2 flex h-2 overflow-hidden bg-at-bg">
                      <span className="bg-at-ontime" style={{ width: barWidth(on_time_pct) }} />
                      <span className="bg-at-late" style={{ width: barWidth(late_pct) }} />
                      <span className="bg-at-early" style={{ width: barWidth(early_pct) }} />
                    </div>
                    <div className="mt-2 space-y-1 text-sm">
                      <BandRow colour="bg-at-ontime" label="On time" value={pctText(on_time_pct)} />
                      <BandRow colour="bg-at-late" label="Late" value={pctText(late_pct)} />
                      <BandRow colour="bg-at-early" label="Early" value={pctText(early_pct)} />
                    </div>
                  </>
                )}
                <p className="mt-2 text-xs leading-snug text-at-muted">
                  {onTimeWindowSentence(mode)}{" "}
                  {cancellations === "counted" ? CANCELLED_SPLIT_COPY : CANCELLED_EXCLUDED_COPY}
                </p>
                {extra}
              </>
            ) : (
              <AverageDetail net={avg_delay_sec} magnitude={avg_abs_delay_sec} />
            )}
          </div>
        </>
      )}
    </>
  );
}
