// src/components/shame/ShameHeader.tsx
// Header shared by the three shame boards: the title block with the window
// controls every other range page uses, the Trips/Routes/Stops tabs, and the
// mode and school chips.

import { RangeControls } from "@/components/date/RangeControls";
import { DelayFilter } from "@/components/filter/DelayFilter";
import { ModeFilter } from "@/components/filter/ModeFilter";
import { SchoolBusToggle } from "@/components/filter/SchoolBusToggle";
import { ChevronLeft } from "@/components/icons";
import type { FilterUsage } from "@/lib/data/filter-usage";
import type { Mode } from "@/lib/mode";
import { preservedFilters } from "@/lib/page/filter-params";
import type { RangeNav } from "@/lib/page/range";
import type { DelayDirection } from "@/lib/rankings";
import { type SchoolFilter } from "@/lib/school-bus";
import Link from "next/link";
import { Suspense, type JSX } from "react";

/** Which board a header is on. */
export type ShameTab = "trip" | "route" | "stop";

const TABS: ReadonlyArray<{ key: ShameTab; label: string }> = [
  { key: "trip", label: "Trips" },
  { key: "route", label: "Routes" },
  { key: "stop", label: "Stops" },
];

/**
 * The mode and school controls for a shame board. Every shame link carries
 * `mode` and `school` - `lib/page/site-nav.ts` puts them on the nav and
 * `buildShameHref` keeps them on every internal link - and the subtitle names the active one, so
 * without these a reader arrives filtered with no way to widen back out.
 */
export interface ShameFilterControls {
  /** Active mode, or null for All. */
  mode: Mode | null;
  /** Which school services count. */
  schools: SchoolFilter;
  /** Window/period/day (and on the day board, hours) params the chips carry through. */
  nav: { window?: string; period?: string; day?: string; hours?: string };
  /**
   * The direction switch, on a board whose rows have a direction. Omitted on a
   * board that ranks whole runs or whole routes, which keeps the chip row off it
   * rather than offering one that changes nothing. Wrapped in an object so
   * "no switch here" cannot be confused with "the switch is on All", which is
   * what a bare `null` would have meant.
   */
  direction?: { active: DelayDirection };
  /**
   * Which modes ran in the window, so the Mode box only offers choices that
   * change the board. Streamed: until it settles the box offers every mode.
   */
  usage: Promise<FilterUsage>;
}

/** Props for {@link ShameHeader}. */
export interface ShameHeaderProps {
  /** Heading text (e.g. "Worst trips of the day"). */
  title: string;
  /** Sub-heading text, already composed and naming the active filter. */
  subtitle: string;
  /** The board this header is on. */
  activeTab: ShameTab;
  /** Pre-built hrefs for the Trips/Routes/Stops tabs. */
  tabHrefs: Record<ShameTab, string>;
  /** The board's own path, which the window controls and the chips link back to. */
  basePath: string;
  /** The day or period stepper for the shown window. */
  nav: RangeNav;
  /** Mode and school chips. */
  filter: ShameFilterControls;
  /**
   * On a day board opened on one hour (by pressing the hour), the link back to
   * the hourly board; undefined on the hourly board itself.
   */
  allHoursHref?: string;
}

/**
 * Shared header for the shame boards, in three or four rows: the title and its subtitle
 * beside {@link RangeControls} (Day | Week | Month and the matching stepper, as
 * on the home, Routes and Cancellations pages); the three board tabs; then the
 * mode and school chips, and on the stops board a fourth row for the direction
 * switch. A board opened on one hour carries a link back to every hour above it all.
 *
 * The tabs sit on their own row rather than among the window controls, because
 * the three boards are three views of one question while the window is a
 * setting over all of them. The active tab is a plain element, not a link, for
 * the reason the nav's is (`SiteNav.tsx`). Each chip keeps the other controls'
 * params through {@link preservedFilters}, so switching mode does not silently
 * drop school services or widen a direction.
 * @param props - Component props.
 * @param props.title - Heading text.
 * @param props.subtitle - Composed sub-heading text.
 * @param props.activeTab - The board this header is on.
 * @param props.tabHrefs - Hrefs for the three tabs.
 * @param props.basePath - The board's own path.
 * @param props.nav - The day or period stepper.
 * @param props.filter - The mode and school chips.
 * @param props.allHoursHref - The link back to the hourly board, on an hour's list.
 * @returns The header element.
 */
export function ShameHeader({
  title,
  subtitle,
  activeTab,
  tabHrefs,
  basePath,
  nav,
  filter,
  allHoursHref,
}: ShameHeaderProps): JSX.Element {
  // Every chip carries the page's window/period/day and the other chips' filters.
  const preserved = preservedFilters(
    {
      mode: filter.mode,
      schools: filter.schools,
      dir: filter.direction?.active ?? null,
    },
    filter.nav,
  );
  return (
    <header className="space-y-3">
      {allHoursHref && (
        <Link
          href={allHoursHref}
          className="inline-flex items-center gap-1 text-sm text-at-shore hover:underline"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to every hour
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-ultra tracking-zero text-at-late sm:text-3xl">{title}</h1>
          <p className="mt-0.5 text-sm text-at-muted">{subtitle}</p>
        </div>
        <RangeControls basePath={basePath} nav={nav} />
      </div>
      <nav aria-label="Shame boards" className="flex flex-wrap items-center gap-1">
        {TABS.map((t) =>
          t.key === activeTab ? (
            <span key={t.key} aria-current="page" className="chip chip-on">
              {t.label}
            </span>
          ) : (
            <Link key={t.key} href={tabHrefs[t.key]} className="chip chip-off">
              {t.label}
            </Link>
          ),
        )}
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <Suspense
          fallback={
            <ModeFilter active={filter.mode} basePath={basePath} preservedParams={preserved.mode} />
          }
        >
          <ShameModeFilter filter={filter} basePath={basePath} preservedParams={preserved.mode} />
        </Suspense>
        <SchoolBusToggle
          value={filter.schools}
          basePath={basePath}
          preservedParams={preserved.school}
        />
      </div>
      {/* Its own row, so a filter on the rows is not read as another filter on
          which modes are counted. */}
      {filter.direction && (
        <DelayFilter
          active={filter.direction.active}
          basePath={basePath}
          preservedParams={preserved.dir}
        />
      )}
    </header>
  );
}

/**
 * The Mode box, once the window's usage is known: a mode that did not run is
 * left out, and the active one always shows so it can be cleared.
 * @param props - Component props.
 * @param props.filter - The board's filters and their usage.
 * @param props.basePath - The board's own path.
 * @param props.preservedParams - Params the Mode box keeps.
 * @returns The box.
 */
async function ShameModeFilter({
  filter,
  basePath,
  preservedParams,
}: {
  filter: ShameFilterControls;
  basePath: string;
  preservedParams: Record<string, string>;
}): Promise<JSX.Element> {
  const usage = await filter.usage;
  return (
    <ModeFilter
      active={filter.mode}
      basePath={basePath}
      preservedParams={preservedParams}
      availableModes={usage.modes}
    />
  );
}
