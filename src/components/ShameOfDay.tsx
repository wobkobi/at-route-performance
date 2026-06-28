import { ModeIcon } from "@/components/ModeIcon";
import { formatDelay, formatDuration } from "@/lib/format";
import { earlyToleranceFor, isOnTime } from "@/lib/on-time";
import { routeSlug } from "@/lib/route-slug";
import { nzClockTime } from "@/lib/time";
import type { ShameTrip } from "@/types/dashboard";
import type { JSX } from "react";

/** Props for {@link ShameOfDay}. */
export interface ShameOfDayProps {
  /** The day's most off-schedule run, or null when the day has no qualifying runs. */
  trip: ShameTrip | null;
  /** Detail-page link (carries the day and active filters). */
  href: string;
  /**
   * The time period being shown - controls empty-state copy. Defaults to `"day"`.
   * Use `"week"` or `"month"` when rendering on the rankings page.
   */
  period?: "day" | "week" | "month";
  /** All hourly shame entries for the day, used to count this route's appearances. */
  hours?: ShameTrip[];
  /** Consecutive days this route has been featured as worst shame trip. */
  routeStreakDays?: number;
}

/**
 * Home banner naming the day's most off-schedule run, linking to the per-hour
 * breakdown. Shows a "no shame" positive state when every run was on time.
 * @param props - Component props.
 * @param props.trip - The day's worst run (or null).
 * @param props.href - Detail-page link (day + active filters).
 * @param props.period - Time period for empty-state copy (`"day"` by default).
 * @param props.hours - All hourly entries for the day, used to count this route's appearances.
 * @param props.routeStreakDays - Consecutive days this route has been the worst shame trip.
 * @returns The banner element.
 */
export function ShameOfDay({
  trip,
  href,
  period = "day",
  hours,
  routeStreakDays = 0,
}: ShameOfDayProps): JSX.Element {
  const isDay = period === "day";
  // No data, or the worst trip's signed average is within the on-time window.
  if (
    !trip ||
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
  return (
    <a
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
        {trip.headsign && <span className="text-base text-at-muted">to {trip.headsign}</span>}
        <span className="text-sm text-at-muted tabular-nums">
          {nzClockTime(trip.scheduled_start)}
        </span>
      </div>
      <p className="text-sm text-at-muted">
        {Math.round(trip.avg_abs_delay_sec) === Math.abs(Math.round(trip.avg_delay_sec)) ? (
          // Single-direction run: absolute and signed averages are the same, so fold
          // the direction word in rather than printing the same time twice.
          <>
            Ran{" "}
            <span
              className={`font-semibold ${(trip.avg_delay_sec ?? 0) >= 0 ? "text-at-late" : "text-at-early"}`}
            >
              {formatDelay(trip.avg_delay_sec, { mode: trip.mode })}
            </span>{" "}
            on average
          </>
        ) : (
          <>
            Ran{" "}
            <span
              className={`font-semibold ${(trip.avg_delay_sec ?? 0) >= 0 ? "text-at-late" : "text-at-early"}`}
            >
              {formatDuration(trip.avg_abs_delay_sec)}
            </span>{" "}
            off schedule on average ({formatDelay(trip.avg_delay_sec, { mode: trip.mode })})
          </>
        )}
      </p>
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
    </a>
  );
}
