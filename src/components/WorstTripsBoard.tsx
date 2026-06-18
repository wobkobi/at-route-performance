import { cn } from "@/lib/cn";
import { formatDelay } from "@/lib/format";
import type { PerTripStat } from "@/types/api";
import type { JSX } from "react";

/** Props for {@link WorstTripsBoard}. */
export interface WorstTripsBoardProps {
  /** Route the trips belong to (for the per-trip links). */
  routeId: string;
  /** Trips, already sorted worst-first by average absolute deviation. */
  trips: PerTripStat[];
  /** Threshold (seconds) beyond which a delay is coloured late/early. */
  thresholdSec: number;
}

/**
 * Auckland-local clock time (e.g. `7:24am`) for an ISO instant.
 * @param iso - ISO instant string.
 * @returns The local time label.
 */
function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-NZ", {
    timeZone: "Pacific/Auckland",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * "Worst bus of the day" board: each run of the route ranked by how far off
 * schedule it was (average absolute deviation), showing the scheduled start,
 * vehicle, stop count, and signed average delay. Each row links to the run's
 * stop-by-stop timeline.
 * @param props - Board props.
 * @param props.routeId - Route the trips belong to.
 * @param props.trips - Trips sorted worst-first.
 * @param props.thresholdSec - Threshold (s) for early/late colour banding.
 * @returns The board element.
 */
export function WorstTripsBoard({
  routeId,
  trips,
  thresholdSec,
}: WorstTripsBoardProps): JSX.Element {
  return (
    <section className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
      <h2 className={cn("mb-1 text-sm font-ultra tracking-zero text-at-late uppercase")}>
        Worst buses of the day
      </h2>
      <p className={cn("mb-3 text-xs text-at-muted")}>
        Each run ranked by how far off schedule it ran, on average.
      </p>
      {trips.length === 0 ? (
        <p className={cn("text-sm text-at-muted")}>No trips recorded for this day yet.</p>
      ) : (
        <ol className={cn("space-y-1")}>
          {trips.map((t, i) => {
            const avg = t.avg_delay_sec ?? 0;
            const valueClass =
              avg > thresholdSec
                ? "text-at-late"
                : avg < -thresholdSec
                  ? "text-at-early"
                  : "text-at-ink";
            return (
              <li
                key={t.trip_id}
                className={cn(
                  "flex items-center gap-3 border-t border-at-border py-1.5 text-sm first:border-0",
                )}
              >
                <span className={cn("w-5 shrink-0 text-right text-at-muted tabular-nums")}>
                  {i + 1}
                </span>
                <a
                  href={`/route/${encodeURIComponent(routeId)}/trip/${encodeURIComponent(t.trip_id)}?d=${encodeURIComponent(t.scheduled_start)}`}
                  className={cn("min-w-0 flex-1 truncate hover:underline")}
                >
                  <span className={cn("font-semibold tabular-nums")}>
                    {localTime(t.scheduled_start)}
                  </span>
                  <span className={cn("text-at-muted")}>
                    {" · "}
                    {t.vehicle_id ?? "unknown bus"}
                    {" · "}
                    {t.stops} stops
                  </span>
                </a>
                <span className={cn("shrink-0 font-semibold tabular-nums", valueClass)}>
                  {t.avg_abs_delay_sec == null ? "—" : formatDelay(avg)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
