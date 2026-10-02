// src/components/shame/ShameOfDay.tsx
// Highlight card for the day's most off-schedule run, linking to its detail page.

import { ModeIcon } from "@/components/ModeIcon";
import { OffScheduleLine } from "@/components/OffScheduleLine";
import { NoWorst, WorstCard, WorstCardTitle } from "@/components/ui/WorstCard";
import { cn } from "@/lib/cn";
import { tripHref } from "@/lib/page/hrefs";
import { routeDisplayName } from "@/lib/route/slug";
import { nzClockTime } from "@/lib/time/format";
import { boundFor } from "@/lib/trip/departure-label";
import type { ShameTrip } from "@/types/dashboard";
import type { JSX } from "react";

/** Props for {@link ShameOfDay}. */
export interface ShameOfDayProps {
  /** The run the board crowns, or null when no run was bad enough to crown. */
  trip: ShameTrip | null;
  /** Whether the board ranked any run, which tells a clean day from an empty one. */
  ranked?: boolean;
  /** Override the card's link target; defaults to the run's own page. */
  href?: string;
  /**
   * The shown window as words for the empty-state copy ("today", "on Sat 19 Sep",
   * "over the last 7 days"; see `windowPhrase`). Defaults to "today".
   */
  when?: string;
  /** All hourly shame entries for the day, used to count this route's appearances. */
  hours?: ShameTrip[];
  /** Days in a row, ending on the shown day, that this route had the day's worst trip. */
  crownedDays?: number;
}

/**
 * Home banner naming the run the worst-trips board crowns, linking to that run.
 * Three states, not two: a quiet "nothing to rank" card when no run qualified,
 * a green "no shame" card when runs ranked and none was bad enough for the
 * board to crown, and the run card itself otherwise. The first two stay apart so
 * a day that recorded nothing never reads as a clean one.
 * @param props - Component props.
 * @param props.trip - The crowned run (or null).
 * @param props.ranked - Whether the board ranked any run.
 * @param props.href - Override link target (optional).
 * @param props.when - The shown window as words for the empty-state copy ("today" by default).
 * @param props.hours - All hourly entries for the day, used to count this route's appearances.
 * @param props.crownedDays - Days in a row, ending on the shown day, that this route had the day's worst trip.
 * @returns The banner element.
 */
export function ShameOfDay({
  trip,
  ranked = false,
  href: hrefProp,
  when = "today",
  hours,
  crownedDays = 0,
}: ShameOfDayProps): JSX.Element {
  // Nothing ranked (no trip cleared SHAME_MIN_STOPS under the active filters)
  // is not the green all-clear: see NoWorst.
  if (!ranked || !trip) {
    return <NoWorst eyebrow="Worst trip" noun="trip" ranked={ranked} when={when} />;
  }

  const name = routeDisplayName(trip);
  const bound = boundFor(trip.headsign, trip.mode);
  const routeHourCount = hours ? hours.filter((h) => h.routeId === trip.routeId).length : 0;
  // The card names one run, so it opens that run. `?d` is the run's own instant,
  // which is how the trip page tells this day's run from the same trip id on
  // another day. The board link belongs on the section heading above.
  const href = hrefProp ?? tripHref(trip.routeId, trip.trip_id, trip.scheduled_start);
  return (
    <WorstCard tone="worst" eyebrow="Worst trip" href={href}>
      <div className="flex flex-wrap items-center gap-2">
        <ModeIcon
          mode={trip.mode}
          shortName={trip.shortName}
          longName={trip.longName}
          className="h-6 w-6"
        />
        <WorstCardTitle>{name}</WorstCardTitle>
      </div>
      {/* The anchor line holds only the route, so it sits level with the stop
          card's name beside it; the headsign takes its own line. */}
      {bound && <p className="text-base text-at-muted">{bound}</p>}
      <OffScheduleLine
        signedSec={trip.avg_delay_sec}
        absSec={trip.avg_abs_delay_sec}
        mode={trip.mode}
        lead={nzClockTime(trip.scheduled_start)}
      />
      {routeHourCount > 1 && (
        <p className="text-xs text-at-muted">
          worst trip in {routeHourCount} of the day&apos;s hours
        </p>
      )}
      {crownedDays >= 2 && (
        <p className={cn("text-at-late", crownedDays >= 4 ? "text-sm font-bold" : "text-xs")}>
          Worst trip of the day on this route {crownedDays} days in a row
        </p>
      )}
    </WorstCard>
  );
}
