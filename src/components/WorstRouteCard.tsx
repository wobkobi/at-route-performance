// src/components/WorstRouteCard.tsx
/**
 * @description Highlight card for the period's most off-schedule route, linking to its shame breakdown.
 */
import { ModeIcon } from "@/components/ModeIcon";
import { formatDelay, formatDuration } from "@/lib/format";
import { isConsistentlyLateOrEarly, isOnTime } from "@/lib/on-time";
import { routeSlug } from "@/lib/route-slug";
import type { ShameRouteRow } from "@/types/dashboard";
import type { JSX } from "react";

/** Props for {@link WorstRouteCard}. */
export interface WorstRouteCardProps {
  /** The period's most off-schedule route, or null when none qualifies. */
  route: ShameRouteRow | null;
  /** Link target for the card (full route-shame breakdown page). */
  href: string;
}

/**
 * Shame dashboard card naming the most off-schedule route for the period.
 * Sits beside the worst-trip and worst-stop cards. Renders nothing when no
 * route qualifies.
 * @param props - Component props.
 * @param props.route - The worst route row (or null).
 * @param props.href - Link to the full route-shame breakdown page.
 * @returns The card element, or null when there is no route to show.
 */
export function WorstRouteCard({ route, href }: WorstRouteCardProps): JSX.Element | null {
  if (!route) return null;
  const name = route.short_name || route.long_name || routeSlug(route.route_id);
  const signedEqAbs = isConsistentlyLateOrEarly(route.avg_delay_sec, route.avg_abs_delay_sec);
  return (
    <a
      href={href}
      className="flex flex-col gap-1 border border-at-late/40 bg-at-surface px-6 py-5 transition-colors hover:bg-at-late/5"
    >
      <p className="text-xs font-semibold tracking-zero text-at-late uppercase">Worst route</p>
      <div className="flex flex-wrap items-center gap-2">
        <ModeIcon
          mode={route.mode}
          shortName={route.short_name}
          longName={route.long_name}
          colour={route.colour}
          className="h-6 w-6"
        />
        <span className="text-2xl font-ultra tracking-zero text-at-ink">{name}</span>
      </div>
      <p className="text-sm text-at-muted">
        {signedEqAbs ? (
          <>
            Ran{" "}
            <span
              className={`font-semibold ${isOnTime(route.avg_delay_sec, route.mode) ? "text-at-ontime" : route.avg_delay_sec < 0 ? "text-at-early" : "text-at-late"}`}
            >
              {formatDelay(route.avg_delay_sec, { mode: route.mode })}
            </span>{" "}
            on average
          </>
        ) : (
          <>
            Ran{" "}
            <span
              className={`font-semibold ${isOnTime(route.avg_delay_sec, route.mode) ? "text-at-ontime" : route.avg_delay_sec < 0 ? "text-at-early" : "text-at-late"}`}
            >
              {formatDuration(route.avg_abs_delay_sec)}
            </span>{" "}
            off schedule on average ({formatDelay(route.avg_delay_sec, { mode: route.mode })})
          </>
        )}
      </p>
      <p className="text-xs text-at-muted tabular-nums">{route.events} events</p>
    </a>
  );
}
