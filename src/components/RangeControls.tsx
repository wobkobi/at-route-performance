"use client";
// src/components/RangeControls.tsx
// Day / Week / Month toggle with the matching stepper for the Routes and
// Cancellations pages. Every link carries the page's other query params (its
// filters) from the live URL, so changing the window keeps them - including the
// ones the Routes page writes on the client without a navigation. The date is
// carried too, from the tab periods the server put on the nav, so switching
// window stays on the day being read rather than resetting to the present.

import { DayNav } from "@/components/DayNav";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { StepPending } from "@/components/StepPending";
import { DATA_START_SHORT } from "@/lib/data-start";
import type { RangeNav, RangeWindow } from "@/lib/range-page";
import { buildHref } from "@/lib/utils";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { JSX } from "react";

/** Params the controls themselves own; everything else is carried through. */
const OWN_PARAMS = new Set(["window", "day", "period"]);

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
  const carried = Object.fromEntries(
    [...searchParams.entries()].filter(([k]) => !OWN_PARAMS.has(k)),
  );
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-2">
        {TABS.filter((t) => !windows || windows.includes(t.key)).map((t) =>
          // The active tab is a span, as the nav tabs are: its href resets the
          // window's own params, so clicking the tab already highlighted moved
          // the reader off the period they were reading and, on a list page,
          // back to its first page.
          nav.window === t.key ? (
            <span key={t.key} aria-current="page" className="chip chip-on">
              {t.label}
            </span>
          ) : (
            <Link
              key={t.key}
              href={buildHref(basePath, {
                ...carried,
                window: t.key === "day" ? undefined : t.key,
                // Each tab carries the date being read across, so switching
                // window keeps the day/week/month instead of jumping to now.
                day: t.key === "day" ? nav.tabs.day : undefined,
                period: t.key === "day" ? undefined : nav.tabs[t.key],
              })}
              scroll={false}
              className="chip chip-off"
            >
              {t.label}
            </Link>
          ),
        )}
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
        />
      ) : (
        <div className="flex items-center gap-1">
          {/* Step links are omitted (not disabled) at the edges of the data range,
              and prefetch in full for the reason DayNav's do. */}
          {nav.prevHref && (
            <Link
              href={withCarried(nav.prevHref, carried)}
              prefetch
              scroll={false}
              className="chip chip-off"
              aria-label={`Previous ${nav.window}`}
            >
              <StepPending>
                <ChevronLeft />
              </StepPending>
            </Link>
          )}
          <span className="px-1 text-sm font-semibold tabular-nums">
            {nav.label}
            {nav.partial ? ` (from ${DATA_START_SHORT})` : ""}
          </span>
          {nav.nextHref && (
            <Link
              href={withCarried(nav.nextHref, carried)}
              prefetch
              scroll={false}
              className="chip chip-off"
              aria-label={`Next ${nav.window}`}
            >
              <StepPending>
                <ChevronRight />
              </StepPending>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
