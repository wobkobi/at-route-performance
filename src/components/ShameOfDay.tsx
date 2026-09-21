// src/components/ShameOfDay.tsx
// Highlight card for the day's most off-schedule run, linking to its detail page.

import { ModeIcon } from "@/components/ModeIcon";
import { OffScheduleLine } from "@/components/OffScheduleLine";
import { earlyToleranceFor, isOnTime } from "@/lib/on-time";
import { routeSlug } from "@/lib/route-slug";
import { nzClockTime } from "@/lib/time";
import type { ShameTrip } from "@/types/dashboard";
import Link from "next/link";
import type { JSX } from "react";

/** Props for {@link ShameOfDay}. */
export interface ShameOfDayProps {
  /** The day's most off-schedule run, or null when the day has no qualifying runs. */
  trip: ShameTrip | null;
  /** Override the card's link target; defaults to the run's own page. */
  href?: string;
  /**
   * The time period being shown - controls empty-state copy. Defaults to `"day"`.
   * Use `"week"` or `"month"` on the home page's week or month view.
   */
  period?: "day" | "week" | "month";
  /** All hourly shame entries for the day, used to count this route's appearances. */
  hours?: ShameTrip[];
  /** Consecutive days this route has been featured as worst shame trip. */
  routeStreakDays?: number;
}

/**
 * Home banner naming the day's most off-schedule run, linking to that run.
 * Three states, not two: a quiet "nothing to rank" card when no run qualified,
 * a green "no shame" card when runs happened and the worst was still on time,
 * and the run card itself otherwise. The first two used to share the green card,
 * which claimed a clean day on days that recorded nothing.
 * @param props - Component props.
 * @param props.trip - The day's worst run (or null).
 * @param props.href - Override link target (optional).
 * @param props.period - Time period for empty-state copy (`"day"` by default).
 * @param props.hours - All hourly entries for the day, used to count this route's appearances.
 * @param props.routeStreakDays - Consecutive days this route has been the worst shame trip.
 * @returns The banner element.
 */
export function ShameOfDay({
  trip,
  href: hrefProp,
  period = "day",
  hours,
  routeStreakDays = 0,
}: ShameOfDayProps): JSX.Element {
  const isDay = period === "day";
  // Nothing qualified, which is not good news and must not read as the green
  // all-clear below. `worst` is the reduce over the per-hour (or per-day) list,
  // so a null trip means that list was empty: no run cleared SHAME_MIN_STOPS
  // under the active filters. Same quiet state the worst-route and worst-stop
  // cards beside this one already use.
  if (!trip) {
    return (
      <div className="flex flex-col gap-1 border border-at-border bg-at-surface px-6 py-5">
        <p className="text-xs font-semibold tracking-zero text-at-muted uppercase">Worst trip</p>
        <span className="text-2xl font-ultra tracking-zero text-at-ink">Nothing to rank yet</span>
        <p className="text-sm text-at-muted">No run has enough arrivals in this period.</p>
      </div>
    );
  }
  // Runs were ranked and the worst of them was still inside the on-time window.
  if (
    trip.avg_abs_delay_sec <= earlyToleranceFor(trip.mode) ||
    isOnTime(trip.avg_delay_sec ?? 0, trip.mode)
  ) {
    return (
      <div className="flex flex-col gap-1 border border-at-ontime/40 bg-at-surface px-6 py-5">
        <p className="text-xs font-semibold tracking-zero text-at-ontime uppercase">Worst trip</p>
        <span className="text-2xl font-ultra tracking-zero text-at-ink">
          {isDay ? "No shame today" : `No shame this ${period}`}
        </span>
        <p className="text-sm text-at-muted">
          {isDay
            ? "No trip stood out today — nothing to call out."
            : `No trip stood out this ${period} — nothing to call out.`}
        </p>
      </div>
    );
  }

  const name = trip.short_name || trip.long_name || routeSlug(trip.route_id);
  const routeHourCount = hours ? hours.filter((h) => h.route_id === trip.route_id).length : 0;
  // The card names one run, so it opens that run. `?d` is the run's own instant,
  // which is how the trip page tells this day's run from the same trip id on
  // another day. The board link belongs on the section heading above.
  const href =
    hrefProp ??
    `/route/${encodeURIComponent(routeSlug(trip.route_id))}/trip/${encodeURIComponent(trip.trip_id)}?d=${encodeURIComponent(trip.scheduled_start)}`;
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 border border-at-late/40 bg-at-surface px-6 py-5 transition-colors hover:bg-at-late/5"
    >
      <p className="text-xs font-semibold tracking-zero text-at-late uppercase">Worst trip</p>
      <div className="flex flex-wrap items-center gap-2">
        <ModeIcon
          mode={trip.mode}
          shortName={trip.short_name}
          longName={trip.long_name}
          colour={trip.colour}
          className="h-6 w-6"
        />
        <span className="text-2xl font-ultra tracking-zero text-at-ink">{name}</span>
      </div>
      {/* The anchor line holds only the route, so it sits level with the stop
          card's name beside it; the headsign takes its own line. */}
      {trip.headsign && <p className="text-base text-at-muted">to {trip.headsign}</p>}
      <OffScheduleLine
        signedSec={trip.avg_delay_sec}
        absSec={trip.avg_abs_delay_sec}
        mode={trip.mode}
        lead={nzClockTime(trip.scheduled_start)}
      />
      {routeHourCount > 1 && (
        <p className="text-xs text-at-muted">
          worst trip in {routeHourCount} of today&apos;s hours
        </p>
      )}
      {routeStreakDays >= 4 && (
        <p className="text-sm font-bold text-at-late">Featured {routeStreakDays} days in a row</p>
      )}
      {routeStreakDays >= 2 && routeStreakDays < 4 && (
        <p className="text-xs text-at-late">Featured {routeStreakDays} days in a row</p>
      )}
    </Link>
  );
}
