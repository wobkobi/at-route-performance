"use client";
// src/components/date/DatePicker.tsx
// The date label of a day or period stepper as a button that opens a calendar,
// so a reader can jump straight to a date instead of stepping one at a time.

import { ChevronLeft, ChevronRight } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { RangeWindow } from "@/lib/page/range";
import {
  monthPickPeriod,
  monthShort,
  monthTitle,
  monthWeeks,
  weekPickPeriod,
  type PickerState,
} from "@/lib/time/calendar";
import { serviceDayLabel, shiftMonth } from "@/lib/time/service-day";
import { buildHref } from "@/lib/utils";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/** Weekday initials over the grid, Monday first. */
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** The panel's width from `sm` up (`sm:w-80`), for choosing which edge it anchors to. */
const PANEL_WIDTH_PX = 320;

/** A step button in the panel's header. */
const STEP =
  "inline-flex h-8 w-8 items-center justify-center border border-at-border text-at-ink hover:border-at-shore disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-at-border";

/**
 * A stepper's date label that opens a calendar. The Day view picks a day, the
 * Week view a whole week (a row), the Month view a month from a year's grid.
 * Dates before the first day with data or after the last openable one are
 * greyed out. Each pick navigates at once, keeping the page's other params.
 * @param props - Component props.
 * @param props.mode - What a pick chooses: a day, a week or a month.
 * @param props.calendar - The bounds, today, and the shown window's days.
 * @param props.basePath - Page path the picks navigate to.
 * @param props.params - The page's other params, carried on every pick; the
 *   picker sets `day`, `window` and `period` itself.
 * @param props.title - Hover text for the label.
 * @param props.className - Classes for the label button.
 * @param props.children - The label.
 * @returns The label and, while open, the calendar.
 */
export function DatePicker({
  mode,
  calendar,
  basePath,
  params,
  title,
  className,
  children,
}: {
  mode: RangeWindow;
  calendar: PickerState;
  basePath: string;
  params: Record<string, string>;
  title?: string;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const router = useRouter();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [alignEnd, setAlignEnd] = useState(false);
  const { today, minDay, maxDay, from, to } = calendar;
  // The month (or, on the Month view, the year) the panel shows; opens on the
  // one holding the end of the shown window.
  const [shown, setShown] = useState(to.slice(0, 7));
  const minMonth = minDay.slice(0, 7);
  const maxMonth = maxDay.slice(0, 7);

  // A page navigated away from is held hidden rather than unmounted; close
  // from a cleanup so the panel is not still open on the way back.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    return () => setOpen(false);
  }, [open]);

  /**
   * Open on the shown window's month, anchored to the label's right edge
   * when a left-anchored panel would run off the screen (the route page's
   * stepper sits at the right).
   */
  const openPanel = (): void => {
    const box = buttonRef.current?.getBoundingClientRect();
    setAlignEnd(box ? box.left + PANEL_WIDTH_PX > window.innerWidth - 16 : false);
    setShown(to.slice(0, 7));
    setOpen(true);
  };

  /** Close and hand focus back to the label. */
  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  /**
   * Close on Escape from the label or the panel.
   * @param e - The key event.
   */
  const onKeyDown = (e: KeyboardEvent): void => {
    if (open && e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };

  /**
   * Navigate to a pick and close.
   * @param set - The window params the pick sets.
   */
  const go = (set: Record<string, string | undefined>): void => {
    setOpen(false);
    router.push(buildHref(basePath, { ...params, ...set }), { scroll: false });
  };

  const year = shown.slice(0, 4);
  const header =
    mode === "month" ? (
      <PanelHeader
        title={year}
        prevLabel="Previous year"
        nextLabel="Next year"
        canPrev={year > minMonth.slice(0, 4)}
        canNext={year < maxMonth.slice(0, 4)}
        onStep={(n) => setShown(shiftMonth(shown, n * 12))}
      />
    ) : (
      <PanelHeader
        title={monthTitle(shown)}
        prevLabel="Previous month"
        nextLabel="Next month"
        canPrev={shown > minMonth}
        canNext={shown < maxMonth}
        onStep={(n) => setShown(shiftMonth(shown, n))}
      />
    );

  return (
    <div className="relative inline-flex" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : openPanel())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        title={title}
        className={cn(
          "border border-transparent underline decoration-at-border decoration-dotted underline-offset-4 hover:border-at-shore hover:decoration-transparent",
          open && "border-at-shore",
          className,
        )}
      >
        {children}
      </button>
      {open && (
        <>
          {/* `pointerdown`, not `click`, as FilterMenu's backdrop: iOS Safari does
              not reliably raise a click on a plain div. */}
          <div className="fixed inset-0 z-40" onPointerDown={close} aria-hidden />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={mode === "day" ? "Choose a day" : `Choose a ${mode}`}
            tabIndex={-1}
            className={cn(
              "fixed inset-x-3 bottom-3 z-50 border border-at-border bg-at-surface p-3 text-at-ink shadow-lg outline-none sm:absolute sm:inset-x-auto sm:top-full sm:bottom-auto sm:mt-1 sm:w-80",
              alignEnd ? "sm:right-0" : "sm:left-0",
            )}
          >
            {header}
            {mode === "month" ? (
              <div className="mt-3 grid grid-cols-3 gap-1">
                {Array.from({ length: 12 }, (_, i) => {
                  const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
                  const on = ym === from.slice(0, 7);
                  return (
                    <button
                      key={ym}
                      type="button"
                      disabled={ym < minMonth || ym > maxMonth}
                      aria-pressed={on}
                      onClick={() =>
                        go({ window: "month", period: monthPickPeriod(ym, today) ?? undefined })
                      }
                      className={cn("h-10 text-sm font-semibold", cellClass(on))}
                    >
                      {monthShort(ym)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3">
                <div className="grid grid-cols-7 pb-1 text-center text-xs text-at-muted">
                  {WEEKDAYS.map((d, i) => (
                    <span key={i} aria-hidden>
                      {d}
                    </span>
                  ))}
                </div>
                {monthWeeks(shown).map((week) =>
                  mode === "week" ? (
                    <WeekRow
                      key={week[0]}
                      week={week}
                      month={shown}
                      calendar={calendar}
                      onPick={() =>
                        go({
                          window: "week",
                          period: weekPickPeriod(week[0]!, today) ?? undefined,
                        })
                      }
                    />
                  ) : (
                    <div key={week[0]} className="grid grid-cols-7 gap-0.5 pb-0.5">
                      {week.map((d) => {
                        const on = d >= from && d <= to;
                        return (
                          <button
                            key={d}
                            type="button"
                            disabled={d < minDay || d > maxDay}
                            aria-pressed={on}
                            aria-label={serviceDayLabel(d)}
                            onClick={() => go({ day: d === today ? undefined : d })}
                            className={cn(
                              "h-9 text-sm tabular-nums",
                              cellClass(on),
                              !on && d.slice(0, 7) !== shown && "text-at-muted",
                              d === today && !on && "font-semibold text-at-shore",
                            )}
                          >
                            {Number(d.slice(8))}
                          </button>
                        );
                      })}
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Colours for a pickable cell: filled when it is the shown window, plain
 * otherwise, faded when out of bounds.
 * @param on - Whether the cell is in the shown window.
 * @returns The classes.
 */
function cellClass(on: boolean): string {
  return cn(
    "border transition-colors disabled:cursor-not-allowed disabled:opacity-30",
    on
      ? "border-at-shore bg-at-shore text-white"
      : "border-transparent hover:border-at-shore enabled:hover:text-at-shore",
  );
}

/**
 * The panel's title between its two step buttons.
 * @param props - Component props.
 * @param props.title - The month or year shown.
 * @param props.prevLabel - Accessible name of the back button.
 * @param props.nextLabel - Accessible name of the forward button.
 * @param props.canPrev - Whether an earlier page has pickable dates.
 * @param props.canNext - Whether a later page has pickable dates.
 * @param props.onStep - Step by -1 or 1.
 * @returns The header.
 */
function PanelHeader({
  title,
  prevLabel,
  nextLabel,
  canPrev,
  canNext,
  onStep,
}: {
  title: string;
  prevLabel: string;
  nextLabel: string;
  canPrev: boolean;
  canNext: boolean;
  onStep: (n: -1 | 1) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        className={STEP}
        disabled={!canPrev}
        aria-label={prevLabel}
        onClick={() => onStep(-1)}
      >
        <ChevronLeft />
      </button>
      <span className="text-sm font-semibold" aria-live="polite">
        {title}
      </span>
      <button
        type="button"
        className={STEP}
        disabled={!canNext}
        aria-label={nextLabel}
        onClick={() => onStep(1)}
      >
        <ChevronRight />
      </button>
    </div>
  );
}

/**
 * One week of the Week view's grid, picked as a whole: the row is one button,
 * so hovering anywhere on it marks the week a click would open.
 * @param props - Component props.
 * @param props.week - The row's seven dates, Monday first.
 * @param props.month - The month the grid shows, for muting days either side.
 * @param props.calendar - The bounds and the shown week.
 * @param props.onPick - Open the row's week.
 * @returns The row.
 */
function WeekRow({
  week,
  month,
  calendar,
  onPick,
}: {
  week: readonly string[];
  month: string;
  calendar: PickerState;
  onPick: () => void;
}): JSX.Element {
  const { today, minDay, maxDay, from, to } = calendar;
  const first = week[0]!;
  const last = week[6]!;
  // A week opens when any of its days can: a first week the archive starts
  // part-way through still has data.
  const disabled = last < minDay || first > maxDay;
  const on = from === first && to === last;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      aria-label={`Week of ${serviceDayLabel(first)}`}
      onClick={onPick}
      className={cn(
        "mb-0.5 grid w-full grid-cols-7 gap-0.5 border text-sm tabular-nums transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-30",
        on
          ? "border-at-shore bg-at-shore text-white"
          : "border-transparent enabled:hover:border-at-shore enabled:hover:bg-at-shore-pale",
      )}
    >
      {week.map((d) => (
        <span
          key={d}
          className={cn(
            "flex h-9 items-center justify-center",
            // Inside the rolling week the days that fall in it are filled on
            // their own, since it rarely lines up with a Monday-to-Sunday row.
            !on && d >= from && d <= to && "bg-at-shore text-white",
            !on && !(d >= from && d <= to) && d.slice(0, 7) !== month && "text-at-muted",
            !on && d === today && !(d >= from && d <= to) && "font-semibold text-at-shore",
          )}
        >
          {Number(d.slice(8))}
        </span>
      ))}
    </button>
  );
}
