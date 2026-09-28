// src/components/shame/ShameHeader.tsx
// Header shared by the three shame boards: the title block with the window
// controls every other range page uses, the Trips/Routes/Stops tabs, and the
// mode and school chips.

import { DelayFilter } from "@/components/DelayFilter";
import { ModeFilter, type ModeFilterValue } from "@/components/ModeFilter";
import { RangeControls } from "@/components/RangeControls";
import { SchoolBusToggle } from "@/components/SchoolBusToggle";
import { preservedFilters } from "@/lib/filter-params";
import type { RangeNav } from "@/lib/range-page";
import type { DelayDirection } from "@/lib/rankings";
import Link from "next/link";
import type { JSX } from "react";

/** Which board a header is on. */
export type ShameTab = "trip" | "route" | "stop";

const TABS: ReadonlyArray<{ key: ShameTab; label: string }> = [
  { key: "trip", label: "Trips" },
  { key: "route", label: "Routes" },
  { key: "stop", label: "Stops" },
];

/**
 * The mode and school controls for a shame board. Every shame link carries
 * `mode` and `school` - `site-nav.ts` puts them on the nav and `buildShameHref`
 * keeps them on every internal link - and the subtitle names the active one, so
 * without these a reader arrives filtered with no way to widen back out.
 */
export interface ShameFilterControls {
  /** Active mode, or null for All. */
  mode: ModeFilterValue;
  /** Whether school services are included. */
  includeSchool: boolean;
  /** Window/period/day params the chips carry through. */
  nav: { window?: string; period?: string; day?: string };
  /**
   * The direction switch, on a board whose rows have a direction. Omitted on a
   * board that ranks whole runs or whole routes, which keeps the chip row off it
   * rather than offering one that changes nothing. Wrapped in an object so
   * "no switch here" cannot be confused with "the switch is on All", which is
   * what a bare `null` would have meant.
   */
  direction?: { active: DelayDirection };
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
}

/**
 * Shared header for the shame boards, in three rows: the title and its subtitle
 * beside {@link RangeControls} (Day | Week | Month and the matching stepper, as
 * on the home, Routes and Cancellations pages); the three board tabs; then the
 * mode and school chips, and on the stops board a fourth row for the direction
 * switch.
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
}: ShameHeaderProps): JSX.Element {
  // Every chip carries the page's window/period/day and the other chips' filters.
  const preserved = preservedFilters(
    {
      mode: filter.mode,
      includeSchool: filter.includeSchool,
      dir: filter.direction?.active ?? null,
    },
    filter.nav,
  );
  return (
    <header className="space-y-3">
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
        <ModeFilter active={filter.mode} basePath={basePath} preservedParams={preserved.mode} />
        <SchoolBusToggle
          active={filter.includeSchool}
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
