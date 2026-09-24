"use client";
// src/components/PunctualityStat.tsx
// Render a punctuality breakdown of early, on-time, and late share bars.

import { cn } from "@/lib/cn";
import { ON_TIME_WINDOW_NOTE } from "@/lib/copy";
import { formatDelay, formatDuration, UNKNOWN_VALUE } from "@/lib/format";
import {
  CANCELLED_EXCLUDED_COPY,
  CANCELLED_SPLIT_COPY,
  earlyToleranceFor,
  ON_TIME_LATE_SEC,
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
  return `On time means ${window}. Early and late are both off schedule. ${ON_TIME_WINDOW_NOTE}`;
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
      <span className="font-semibold tabular-nums">{pct == null ? UNKNOWN_VALUE : `${pct}%`}</span>
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
  return (
    <div
      className={cn(
        "relative bg-at-surface",
        bare ? "" : "border border-at-border",
        size === "lg" ? "p-4" : "p-3",
      )}
    >
      {/* Card text stays plain (selectable); only the info button opens the popover. */}
      <div className="flex items-center gap-1 text-xs tracking-zero text-at-muted uppercase">
        {label}
        <PunctualityInfo label={label} breakdown={breakdown} variant={variant} />
      </div>
      <span
        className={cn(
          "block font-ultra tracking-zero tabular-nums",
          size === "lg" ? "text-2xl" : "text-xl",
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
                  </>
                )}
                <p className="mt-2 text-xs leading-snug text-at-muted">
                  {onTimeWindowDescription(mode)}{" "}
                  {cancellations === "counted" ? CANCELLED_SPLIT_COPY : CANCELLED_EXCLUDED_COPY}
                </p>
                {extra}
              </>
            ) : (
              <>
                <p className="text-xs font-semibold tracking-zero text-at-muted uppercase">
                  Averages
                </p>
                <div className="mt-2 space-y-1 text-sm">
                  {/* Both figures are means, so neither applies the on-time window: a stop that runs
                      as early as it runs late nets near zero, and "on time" above a magnitude of
                      9m would contradict it. */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-at-muted">Early or late, net</span>
                    <span className="font-semibold tabular-nums">
                      {avg_delay_sec == null
                        ? UNKNOWN_VALUE
                        : formatDelay(avg_delay_sec, { thresholdSec: 0 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-at-muted">Off by, ignoring direction</span>
                    <span className="font-semibold tabular-nums">
                      {avg_abs_delay_sec == null
                        ? UNKNOWN_VALUE
                        : formatDuration(avg_abs_delay_sec)}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-snug text-at-muted">
                  Earlies and lates cancel in the net average, so it nears zero even when many runs
                  are off. &ldquo;Off by&rdquo; is the typical distance from schedule, whichever way
                  a run was out.
                </p>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
