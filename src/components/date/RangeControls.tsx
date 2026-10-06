"use client";
// src/components/date/RangeControls.tsx
// Day / Week / Month toggle with the matching stepper for the Routes and
// Cancellations pages. Every link carries the page's other query params (its
// filters) from the live URL, so changing the window keeps them - including the
// ones the Routes page writes on the client without a navigation. The date is
// carried too, from the tab periods the server put on the nav, so switching
// window stays on the day being read rather than resetting to the present.

import { ChipTab, StepperLink } from "@/components/Chip";
import { DatePicker } from "@/components/date/DatePicker";
import { DayNav } from "@/components/date/DayNav";
import { omitParams, SHOWN_PARAM, VIEW_PARAMS } from "@/lib/page/filter-params";
import type { RangeNav, RangeWindow } from "@/lib/page/range";
import { DATA_START_SHORT } from "@/lib/time/data-start";
import { buildHref } from "@/lib/utils";
import { useSearchParams } from "next/navigation";
import { type JSX, useState } from "react";

/**
 * Params a window switch leaves behind: the window's own, which each link sets,
 * and the list length, since a new window is a new list. Everything else (the
 * filters, sort and search) carries.
 */
const NOT_CARRIED = [...VIEW_PARAMS, SHOWN_PARAM];

/** Props for {@link RangeControls}. */
export interface RangeControlsProps {
  /** The page path the links point at. */
  basePath: string;
  /** The stepper state for the active window. */
  nav: RangeNav;
  /** The window tabs to offer; every window when omitted. */
  windows?: readonly RangeWindow[];
}

const TABS: ReadonlyArray<{ key: RangeWindow; label: string }> = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

/**
 * Add the carried params to an href that sets only the window's own params.
 * @param href - The href (path plus `window`/`day`/`period`).
 * @param carried - The page's other params.
 * @returns The href with both.
 */
function withCarried(href: string, carried: Record<string, string>): string {
  const [path = "", qs = ""] = href.split("?");
  return buildHref(path, { ...Object.fromEntries(new URLSearchParams(qs)), ...carried });
}

/**
 * Render the window toggle and its stepper: the day stepper on the day view, a
 * previous/next period stepper around the period label otherwise.
 * @param props - Component props.
 * @param props.basePath - The page path the links point at.
 * @param props.nav - The stepper state for the active window.
 * @param props.windows - The window tabs to offer; every window when omitted.
 * @returns The controls.
 */
export function RangeControls({ basePath, nav, windows }: RangeControlsProps): JSX.Element {
  const searchParams = useSearchParams();
  const carried = omitParams(searchParams, NOT_CARRIED);
  // A neighbouring week or month is a whole period of boards, and a full
  // prefetch on load rendered it beside the page itself: on a cold cache the two
  // queued behind each other on the database. So each period chevron prefetches
  // in full only once the reader points at, focuses or presses it.
  const [intent, setIntent] = useState({ prev: false, next: false });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-2">
        {TABS.filter((t) => !windows || windows.includes(t.key)).map((t) => (
          <ChipTab
            key={t.key}
            active={nav.window === t.key}
            href={buildHref(basePath, {
              ...carried,
              window: t.key === "day" ? undefined : t.key,
              // Each tab carries the date being read across, so switching
              // window keeps the day/week/month instead of jumping to now.
              day: t.key === "day" ? nav.tabs.day : undefined,
              period: t.key === "day" ? undefined : nav.tabs[t.key],
            })}
          >
            {t.label}
          </ChipTab>
        ))}
      </div>
      {nav.window === "day" ? (
        <DayNav
          basePath={basePath}
          serviceDate={nav.serviceDate}
          preservedParams={carried}
          hasPrev={nav.hasPrev}
          hasNext={nav.hasNext}
          nextHref={nav.nextIsToday ? buildHref(basePath, carried) : undefined}
          atFloor={nav.atFloor}
          nextPending={nav.nextPending}
          calendar={nav.calendar}
        />
      ) : (
        <div className="flex items-center gap-1">
          {/* Step links are omitted (not disabled) at the edges of the data range,
              and the empty slot holds the gap so the newest period does not
              shift the tabs. */}
          <StepperLink
            href={nav.prevHref && withCarried(nav.prevHref, carried)}
            dir="prev"
            label={`Previous ${nav.window}`}
            prefetch={intent.prev ? true : null}
            onIntent={() => setIntent((s) => (s.prev ? s : { ...s, prev: true }))}
          />
          <DatePicker
            mode={nav.window}
            calendar={nav.calendar}
            basePath={basePath}
            preservedParams={carried}
            hint={`Choose a ${nav.window}`}
            className="px-2 py-1 text-sm font-semibold tabular-nums"
          >
            {nav.label}
            {nav.partial ? ` (from ${DATA_START_SHORT})` : ""}
          </DatePicker>
          <StepperLink
            href={nav.nextHref && withCarried(nav.nextHref, carried)}
            dir="next"
            label={`Next ${nav.window}`}
            prefetch={intent.next ? true : null}
            onIntent={() => setIntent((s) => (s.next ? s : { ...s, next: true }))}
          />
        </div>
      )}
    </div>
  );
}
