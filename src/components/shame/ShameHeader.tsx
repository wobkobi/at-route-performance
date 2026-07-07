// src/components/shame/ShameHeader.tsx
/**
 * @description Shame view header with the active tab and a day or week stepper control.
 */
import { DayNav } from "@/components/DayNav";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { cn } from "@/lib/cn";
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
}

/**
 * Shared header for the shame boards (and the dashboard): the title block, the
 * Trips/Routes/Stops tab row, and either a day stepper (`DayNav`) or a week
 * stepper. The active tab is highlighted; the dashboard passes `activeTab="none"`
 * and omits the week toggle.
 * @param props - Component props.
 * @param props.title - Heading text.
 * @param props.subtitle - Composed sub-heading text.
 * @param props.activeTab - The active tab, or "none".
 * @param props.tabHrefs - Hrefs for the three tabs.
 * @param props.nav - The day or week stepper controls.
 * @returns The header element.
 */
export function ShameHeader({
  title,
  subtitle,
  activeTab,
  tabHrefs,
  nav,
}: ShameHeaderProps): JSX.Element {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-ultra tracking-zero text-at-late sm:text-3xl">{title}</h1>
        <p className="mt-0.5 text-sm text-at-muted">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <a
            href={tabHrefs.trip}
            className={cn("chip", activeTab === "trip" ? "chip-on" : "chip-off")}
          >
            Trips
          </a>
          <a
            href={tabHrefs.route}
            className={cn("chip", activeTab === "route" ? "chip-on" : "chip-off")}
          >
            Routes
          </a>
          <a
            href={tabHrefs.stop}
            className={cn("chip", activeTab === "stop" ? "chip-on" : "chip-off")}
          >
            Stops
          </a>
        </div>
        {nav.kind === "day" ? (
          <>
            {nav.weekToggleHref && (
              <a href={nav.weekToggleHref} className="chip chip-off text-sm">
                Week
              </a>
            )}
            <DayNav
              basePath={nav.basePath}
              serviceDate={nav.serviceDate}
              preservedParams={nav.preserved}
              hasPrev={nav.hasPrev}
              hasNext={nav.hasNext}
              nextHref={nav.nextHref}
            />
          </>
        ) : (
          <>
            <a href={nav.dayToggleHref} className="chip chip-off text-sm">
              Day
            </a>
            <div className="flex items-center gap-1">
              {nav.prevHref ? (
                <a
                  href={nav.prevHref}
                  aria-label={`Previous ${nav.unit ?? "week"}`}
                  className="chip chip-off flex items-center"
                >
                  <ChevronLeft className="block h-4 w-4" />
                </a>
              ) : null}
              <span className="px-1 text-sm font-semibold tabular-nums">{nav.periodLabel}</span>
              {nav.nextHref ? (
                <a
                  href={nav.nextHref}
                  aria-label={`Next ${nav.unit ?? "week"}`}
                  className="chip chip-off flex items-center"
                >
                  <ChevronRight className="block h-4 w-4" />
                </a>
              ) : null}
            </div>
          </>
        )}
      </div>
    </header>
  );
}
