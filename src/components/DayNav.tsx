import { ChevronLeft, ChevronRight } from "@/components/icons";
import Link from "next/link";
import type { JSX } from "react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Props for {@link DayNav}. */
export interface DayNavProps {
  /** Page path the day links point at. */
  basePath: string;
  /** The shown service date as `YYYY-MM-DD`. */
  serviceDate: string;
  /** Query params to preserve on the links (the `day` param is set here). */
  preservedParams: Record<string, string>;
  /** Whether a previous (earlier) day link should be offered (false on the earliest day with data). */
  hasPrev: boolean;
  /** Whether a next (later) day link should be offered (false on the latest day). */
  hasNext: boolean;
  /**
   * Override href for the next-day link. Pass the clean base URL when the next
   * day is today so the server's `dropTodayParam` redirect is never triggered.
   */
  nextHref?: string;
}

/**
 * Shift a `YYYY-MM-DD` date by whole days.
 * @param ymd - The date.
 * @param delta - Days to add (may be negative).
 * @returns The shifted `YYYY-MM-DD`.
 */
function shiftDate(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/**
 * Format a `YYYY-MM-DD` service date as `Wed 18 Jun`.
 * @param ymd - The date.
 * @returns The label.
 */
function dateLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${d} ${MONTHS[m - 1]}`;
}

/**
 * Build a day link href preserving the other params.
 * @param basePath - Page path.
 * @param preserved - Params to keep.
 * @param day - The `day` value to set.
 * @returns The href.
 */
function dayHref(basePath: string, preserved: Record<string, string>, day: string): string {
  return `${basePath}?${new URLSearchParams({ ...preserved, day }).toString()}`;
}

/**
 * Service-day stepper: prev / current date / next, as `?day=` links. The prev
 * link is omitted on the earliest service day with data and the next link on the
 * latest, so you cannot page past where data exists in either direction.
 * @param props - Component props.
 * @param props.basePath - Page path the day links point at.
 * @param props.serviceDate - The shown service date (`YYYY-MM-DD`).
 * @param props.preservedParams - Query params to keep when changing day.
 * @param props.hasPrev - Whether to offer a previous-day link.
 * @param props.hasNext - Whether to offer a next-day link.
 * @param props.nextHref
 * @returns The day navigation element.
 */
export function DayNav({
  basePath,
  serviceDate,
  preservedParams,
  hasPrev,
  hasNext,
  nextHref,
}: DayNavProps): JSX.Element {
  return (
    <div className="flex items-center gap-1">
      {/* Step links are omitted (not disabled) at the edges of the data range. */}
      {hasPrev && (
        <Link
          href={dayHref(basePath, preservedParams, shiftDate(serviceDate, -1))}
          className="chip chip-off"
          aria-label="Previous day"
        >
          <ChevronLeft />
        </Link>
      )}
      <span className="px-2 text-sm font-semibold tabular-nums">{dateLabel(serviceDate)}</span>
      {hasNext && (
        <Link
          href={nextHref ?? dayHref(basePath, preservedParams, shiftDate(serviceDate, 1))}
          className="chip chip-off"
          aria-label="Next day"
        >
          <ChevronRight />
        </Link>
      )}
    </div>
  );
}
