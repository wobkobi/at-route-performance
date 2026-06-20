// src/app/route/[id]/trip/[tripId]/page.tsx
import { cn } from "@/lib/cn";
import { getTripTimeline } from "@/lib/data";
import { formatDelay } from "@/lib/format";
import { linkColour } from "@/lib/link-colour";
import { nzServiceDayRange } from "@/lib/time";
import type { JSX } from "react";

const THRESHOLD_SEC = 300;

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
 * Trip timeline page: one run's stop-by-stop scheduled-vs-actual punctuality.
 * @param root0 - Page props.
 * @param root0.params - Dynamic route params `{ id, tripId }`.
 * @param root0.searchParams - Optional query params (`d` = the run's instant).
 * @returns Page markup.
 */
export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; tripId: string }>;
  searchParams?: Promise<{ d?: string }>;
}): Promise<JSX.Element> {
  const { id, tripId } = await params;
  const { d } = (await searchParams) ?? {};
  // Scope to the run's Auckland-local day so other days' runs of the same tripId
  // do not interleave; falls back to the trip's latest day when `d` is absent.
  const day = d ? nzServiceDayRange(new Date(d)) : undefined;
  const timeline = await getTripTimeline(tripId, id, day);
  const { route, stops, vehicle_id } = timeline;

  const title = route?.shortName ?? id;
  const colour = linkColour(route?.shortName, route?.longName);
  const departing = stops[0]?.scheduled_at;

  return (
    <main className={cn("space-y-6")}>
      <a
        href={`/route/${encodeURIComponent(id)}`}
        className={cn("text-sm text-at-shore hover:underline")}
      >
        &lsaquo; Back to {title}
      </a>

      <header className="space-y-1">
        <h1 className="flex items-center gap-3 text-3xl leading-headline font-ultra tracking-zero">
          {colour && (
            <span
              aria-hidden="true"
              className={cn("inline-block h-4 w-4 shrink-0 rounded-full", colour)}
            />
          )}
          {title}
        </h1>
        <p className="text-at-muted">
          {departing ? `Trip departing ${localTime(departing)}` : "Trip"}
          {vehicle_id && ` · ${vehicle_id}`}
        </p>
      </header>

      {stops.length === 0 ? (
        <p className={cn("rounded-xl bg-at-surface p-4 text-at-muted shadow-sm")}>
          No stop records found for this trip.
        </p>
      ) : (
        <section className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
          <ol className={cn("space-y-0")}>
            {stops.map((s, i) => {
              const d = s.deviation_sec;
              const band =
                d > THRESHOLD_SEC
                  ? "text-at-late"
                  : d < -THRESHOLD_SEC
                    ? "text-at-early"
                    : "text-at-ink";
              const dotColour = d > 5 ? "bg-at-late" : d < -5 ? "bg-at-early" : "bg-at-ontime";
              return (
                <li key={`${s.stop_id}-${i}`} className={cn("flex items-stretch gap-3")}>
                  {/* Timeline rail: a dot per stop joined by a connector line. */}
                  <div className={cn("flex w-3 flex-col items-center")}>
                    <span className={cn("h-3 w-3 shrink-0 rounded-full", dotColour)} />
                    {i < stops.length - 1 && (
                      <span className={cn("w-px flex-1 bg-at-border")} aria-hidden="true" />
                    )}
                  </div>
                  <div className={cn("flex flex-1 items-baseline justify-between gap-3 pb-4")}>
                    <div className="min-w-0">
                      <p className={cn("truncate font-medium")}>{s.name}</p>
                      <p className={cn("text-xs text-at-muted tabular-nums")}>
                        {localTime(s.scheduled_at)}
                      </p>
                    </div>
                    <span className={cn("shrink-0 text-sm font-semibold tabular-nums", band)}>
                      {formatDelay(d, { thresholdSec: THRESHOLD_SEC })}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </main>
  );
}
