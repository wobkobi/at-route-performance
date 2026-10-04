// src/components/shame/ShameHeader.tsx
// Header shared by the three shame boards: the title block with the window
// controls every other range page uses, the Trips/Routes/Stops tabs, and the
// mode and school chips.

import { ChipTab } from "@/components/Chip";
import { RangeControls } from "@/components/date/RangeControls";
import { DelayFilter } from "@/components/filter/DelayFilter";
import { ModeUsageFilter } from "@/components/filter/ModeUsageFilter";
import { SchoolBusToggle } from "@/components/filter/SchoolBusToggle";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";
import type { FilterUsage } from "@/lib/data";
import type { Mode } from "@/lib/mode";
import type { ShameBoard } from "@/lib/og";
import { preservedFilters } from "@/lib/page/filter-params";
import type { RangeNav } from "@/lib/page/range";
import type { DelayDirection } from "@/lib/rankings";
import { type SchoolFilter } from "@/lib/school-bus";
import type { JSX } from "react";

const TABS: ReadonlyArray<{ key: ShameBoard; label: string }> = [
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
  /** Sub-heading text, already composed and naming the active filter; the full stop is added here. */
  subtitle: string;
  /** The board this header is on. */
  activeTab: ShameBoard;
  /** Pre-built hrefs for the Trips/Routes/Stops tabs. */
  tabHrefs: Record<ShameBoard, string>;
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
 * @returns The header and its control rows.
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
    <div className="space-y-3">
      {allHoursHref && <BackLink href={allHoursHref} to="every hour" />}
      <PageHeader
        title={title}
        tone="late"
        subtitle={`${subtitle}.`}
        actions={<RangeControls basePath={basePath} nav={nav} />}
      />
      <nav aria-label="Shame boards" className="flex flex-wrap items-center gap-1">
        {TABS.map((t) => (
          <ChipTab key={t.key} href={tabHrefs[t.key]} active={t.key === activeTab}>
            {t.label}
          </ChipTab>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <ModeUsageFilter
          active={filter.mode}
          basePath={basePath}
          preservedParams={preserved.mode}
          modes={filter.usage.then((u) => u.modes)}
        />
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
    </div>
  );
}
