import { cn } from "@/lib/cn";
import type { TripSort } from "@/lib/data";
import { formatDelay } from "@/lib/format";
import type { PerTripStat } from "@/types/api";
import type { JSX } from "react";

/** Props for {@link WorstTripsBoard}. */
export interface WorstTripsBoardProps {
  /** Route the trips belong to (for the per-trip links). */
  routeId: string;
  /** Trips for the day, already ordered by `sort`. */
  trips: PerTripStat[];
  /** Threshold (seconds) beyond which a delay is coloured late/early. */
  thresholdSec: number;
  /** Active ordering. */
  sort: TripSort;
  /** Route mode, for the heading noun (bus/train/ferry). */
  mode?: string;
  /** Page path the sort links point at (the route page). */
  basePath: string;
  /** Query params to preserve on the sort links (the `tsort` param is set here). */
  preservedParams: Record<string, string>;
}

/** Plural service noun per mode, for the board heading. */
const MODE_NOUN: Record<string, string> = { BUS: "Buses", TRAIN: "Trains", FERRY: "Ferries" };

const SORTS: { key: TripSort; label: string }[] = [
  { key: "off", label: "Most off" },
  { key: "late", label: "Latest" },
  { key: "early", label: "Earliest" },
  { key: "departure", label: "Departure" },
];

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
 * Board of a route's runs for the day, ordered by the chosen sort (most
 * off-schedule, latest, earliest, or departure time). Each row shows the
 * scheduled start, vehicle, stop count, and signed average delay, and links to
 * the run's stop-by-stop timeline.
 * @param props - Board props.
 * @param props.routeId - Route the trips belong to.
 * @param props.trips - Trips ordered by the active sort.
 * @param props.thresholdSec - Threshold (s) for early/late colour banding.
 * @param props.sort - The active ordering.
 * @param props.mode - Route mode, for the heading noun.
 * @param props.basePath - Page path the sort links point at.
 * @param props.preservedParams - Query params to keep when changing sort.
 * @returns The board element.
 */
export function WorstTripsBoard({
  routeId,
  trips,
  thresholdSec,
  sort,
  mode,
  basePath,
  preservedParams,
}: WorstTripsBoardProps): JSX.Element {
  const noun = (mode && MODE_NOUN[mode]) ?? "Services";
  return (
    <section className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
      <div className={cn("mb-3 flex flex-wrap items-center justify-between gap-2")}>
        <h2 className={cn("text-sm font-ultra tracking-zero text-at-late uppercase")}>
          {noun} of the day
        </h2>
        <div className={cn("flex flex-wrap gap-1")}>
          {SORTS.map((s) => {
            const params = new URLSearchParams({
              ...preservedParams,
              ...(s.key === "off" ? {} : { tsort: s.key }),
            });
            const href = params.toString() ? `${basePath}?${params.toString()}` : basePath;
            return (
              <a
                key={s.key}
                href={href}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold",
                  s.key === sort ? "bg-at-shore text-white" : "bg-at-bg text-at-ink",
                )}
              >
                {s.label}
              </a>
            );
          })}
        </div>
      </div>
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
