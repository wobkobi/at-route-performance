// src/components/shame/ShameHeader.tsx
// Shame view header with the active tab and a day or week stepper control.

import { DayNav } from "@/components/DayNav";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { ModeFilter, type ModeFilterValue } from "@/components/ModeFilter";
import { SchoolBusToggle } from "@/components/SchoolBusToggle";
import { StepPending } from "@/components/StepPending";
import { cn } from "@/lib/cn";
import Link from "next/link";
import type { JSX } from "react";

/** Which board tab is active, or "none" for the dashboard. */
type ShameTab = "trip" | "route" | "stop" | "none";

/** The right-side controls: a day stepper or a week stepper. */
export type ShameNav =
  | {
      kind: "day";
      /** Link to the week view; omit to hide the Week toggle (e.g. the dashboard). */
      weekToggleHref?: string;
      basePath: string;
      serviceDate: string;
      preserved: Record<string, string>;
      hasPrev: boolean;
      hasNext: boolean;
      nextHref?: string;
      /** Whether the shown day is the archive's first, so the absent chevron reads as a fact. */
      atFloor?: boolean;
      /** Whether the next day is today and has not opened yet. */
      nextPending?: boolean;
    }
  | {
      kind: "week";
      /** Stepper unit for the aria labels; the week shape also serves month views. */
      unit?: "week" | "month";
      /** Link back to the day view. */
      dayToggleHref: string;
      periodLabel: string;
      prevHref: string | null;
      nextHref: string | null;
    };

/**
 * The mode and school controls for a shame surface. Every shame link carries
 * `mode` and `school` - `site-nav.ts` puts them on the nav and
 * `buildShameHref` keeps them on every internal link - and the subtitle names
 * the active one, so without these a reader arrives filtered with no way to
 * widen back out.
 */
export interface ShameFilterControls {
  /** Path the chips link to (this surface's own path). */
  basePath: string;
  /** Active mode, or null for All. */
  mode: ModeFilterValue;
  /** Whether school services are included. */
  includeSchool: boolean;
  /** Window/period/day params the chips carry through. */
  nav: { window?: string; period?: string; day?: string };
}

/** Props for {@link ShameHeader}. */
export interface ShameHeaderProps {
  /** Heading text (e.g. "Shame of the Day"). */
  title: string;
  /** Sub-heading text, already composed (e.g. "The most off-schedule run of each hour · Buses"). */
  subtitle: string;
  /** Active tab, or "none" on the dashboard. */
  activeTab: ShameTab;
  /** Pre-built hrefs for the Trips/Routes/Stops tabs. */
  tabHrefs: { trip: string; route: string; stop: string };
  /** The day or week stepper controls. */
  nav: ShameNav;
  /** Mode and school chips; omit to leave the surface unfiltered. */
  filter?: ShameFilterControls;
}

/**
 * Shared header for the shame boards (and the dashboard): the title block, the
 * Trips/Routes/Stops tab row, and either a day stepper (`DayNav`) or a week
 * stepper. The active tab is highlighted; the dashboard passes `activeTab="none"`
 * and omits the week toggle.
 *
 * With `filter` set it also carries the mode and school chips, on their own row
 * under the title so they sit beside the subtitle that names the active one.
 * Each chip keeps the other control's param, so switching mode does not silently
 * drop school services.
 * @param props - Component props.
 * @param props.title - Heading text.
 * @param props.subtitle - Composed sub-heading text.
 * @param props.activeTab - The active tab, or "none".
 * @param props.tabHrefs - Hrefs for the three tabs.
 * @param props.nav - The day or week stepper controls.
 * @param props.filter - The mode and school chips (optional).
 * @returns The header element.
 */
export function ShameHeader({
  title,
  subtitle,
  activeTab,
  tabHrefs,
  nav,
  filter,
}: ShameHeaderProps): JSX.Element {
  // Each chip keeps the other control's param, so switching mode does not
  // silently drop school services, and the window/period/day the page is on
  // rides through both.
  const navParams: Record<string, string> = {};
  if (filter?.nav.window) navParams.window = filter.nav.window;
  if (filter?.nav.period) navParams.period = filter.nav.period;
  if (filter?.nav.day) navParams.day = filter.nav.day;
  const modePreserved = filter?.includeSchool ? { ...navParams, school: "1" } : navParams;
  const schoolPreserved = filter?.mode ? { ...navParams, mode: filter.mode } : navParams;
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-ultra tracking-zero text-at-late sm:text-3xl">{title}</h1>
        <p className="mt-0.5 text-sm text-at-muted">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Link
            href={tabHrefs.trip}
            className={cn("chip", activeTab === "trip" ? "chip-on" : "chip-off")}
          >
            Trips
          </Link>
          <Link
            href={tabHrefs.route}
            className={cn("chip", activeTab === "route" ? "chip-on" : "chip-off")}
          >
            Routes
          </Link>
          <Link
            href={tabHrefs.stop}
            className={cn("chip", activeTab === "stop" ? "chip-on" : "chip-off")}
          >
            Stops
          </Link>
        </div>
        {nav.kind === "day" ? (
          <>
            {nav.weekToggleHref && (
              <Link href={nav.weekToggleHref} className="chip chip-off text-sm">
                Week
              </Link>
            )}
            <DayNav
              basePath={nav.basePath}
              serviceDate={nav.serviceDate}
              preservedParams={nav.preserved}
              hasPrev={nav.hasPrev}
              hasNext={nav.hasNext}
              nextHref={nav.nextHref}
              atFloor={nav.atFloor}
              nextPending={nav.nextPending}
            />
          </>
        ) : (
          <>
            <Link href={nav.dayToggleHref} className="chip chip-off text-sm">
              Day
            </Link>
            {/* Period steps prefetch in full for the reason DayNav's do. */}
            <div className="flex items-center gap-1">
              {nav.prevHref ? (
                <Link
                  href={nav.prevHref}
                  prefetch
                  aria-label={`Previous ${nav.unit ?? "week"}`}
                  className="chip chip-off flex items-center"
                >
                  <StepPending>
                    <ChevronLeft className="block h-4 w-4" />
                  </StepPending>
                </Link>
              ) : null}
              <span className="px-1 text-sm font-semibold tabular-nums">{nav.periodLabel}</span>
              {nav.nextHref ? (
                <Link
                  href={nav.nextHref}
                  prefetch
                  aria-label={`Next ${nav.unit ?? "week"}`}
                  className="chip chip-off flex items-center"
                >
                  <StepPending>
                    <ChevronRight className="block h-4 w-4" />
                  </StepPending>
                </Link>
              ) : null}
            </div>
          </>
        )}
      </div>
      {/* `w-full` puts the chips on their own line of the wrapping header, so
          they read as filters over the whole page rather than as more tabs. */}
      {filter && (
        <div className="flex w-full flex-wrap items-center gap-3">
          <ModeFilter
            active={filter.mode}
            basePath={filter.basePath}
            preservedParams={modePreserved}
          />
          <SchoolBusToggle
            active={filter.includeSchool}
            basePath={filter.basePath}
            preservedParams={schoolPreserved}
          />
        </div>
      )}
    </header>
  );
}
