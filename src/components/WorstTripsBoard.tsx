// src/components/WorstTripsBoard.tsx
/**
 * @description Paginated, sortable table of a route's worst trips with delay
 * bands. Sort chips reset to page 1 and clicking the active chip toggles its
 * direction, while the prev/next page links preserve the active sort so paging
 * doesn't drop it. Cancelled trips carry no delay to rank, so they pin to the
 * top of page 1 with a CANCELLED badge; running trips get a LIVE badge from the
 * passed-in live id set, and the per-page rank number stays continuous across
 * pages.
 */
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { CancelledTripRow, TripSort } from "@/lib/data";
import { formatDelay } from "@/lib/format";
import { MODE_NOUN } from "@/lib/mode";
import { delayBand } from "@/lib/on-time";
import { nzClockTime } from "@/lib/time";
import type { PerTripStat } from "@/types/api";
import type { JSX } from "react";

/** Props for {@link WorstTripsBoard}. */
export interface WorstTripsBoardProps {
  /** Route the trips belong to (for the per-trip links). */
  routeId: string;
  /** The current page of trips, already ordered by `sort`. */
  trips: PerTripStat[];
  /** Active ordering. */
  sort: TripSort;
  /** Whether the active sort direction is reversed from its default. */
  isReversed?: boolean;
  /** Route mode: heading noun + the mode's early/late colour banding. */
  mode?: string;
  /** Page path the sort + page links point at (the route page). */
  basePath: string;
  /** Query params to preserve on the links (`tsort`/`tpage` are set here). */
  preservedParams: Record<string, string>;
  /** 1-based current page. */
  page: number;
  /** Total number of pages. */
  totalPages: number;
  /** Trips shown per page (sets the row's continuous rank number). */
  pageSize: number;
  /** Trip ids currently running live; those rows get a LIVE badge. */
  liveTripIds?: Set<string>;
  /** Trips cancelled today; listed at the top of page 1 with a CANCELLED badge. */
  cancelledTrips?: CancelledTripRow[];
}

/**
 * Compact page list around the current page: always the first and last page,
 * the current page and its neighbours, with `"…"` gaps for the runs in between
 * (e.g. `1 … 5 6 7 … 50`).
 * @param current - The active 1-based page.
 * @param total - Total number of pages.
 * @returns Page numbers interleaved with `"…"` gap markers.
 */
function pageWindow(current: number, total: number): (number | "…")[] {
  const wanted = [1, total, current, current - 1, current + 1];
  const nums = [...new Set(wanted)].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const n of nums) {
    if (n - prev > 1) out.push("…");
    out.push(n);
    prev = n;
  }
  return out;
}

/**
 * Build a board page-link href, preserving the other params and the active sort
 * so paging does not reset the sort (unlike the sort links, which reset to 1).
 * @param basePath - Page path the link points at.
 * @param preserved - Params to keep (day/threshold).
 * @param sort - The active ordering (added unless it is the default `"off"`).
 * @param page - The 1-based page to link to.
 * @returns The href.
 */
function pageHref(
  basePath: string,
  preserved: Record<string, string>,
  sort: TripSort,
  page: number,
): string {
  // `preserved` already contains trev when set; spread it first so tsort/tpage
  // can override without losing other preserved params.
  const params = new URLSearchParams({
    ...preserved,
    ...(sort === "off" ? {} : { tsort: sort }),
    ...(page > 1 ? { tpage: String(page) } : {}),
  });
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

const SORTS: { key: TripSort; label: string }[] = [
  { key: "off", label: "Most off" },
  { key: "late", label: "Latest" },
  { key: "early", label: "Earliest" },
  { key: "departure", label: "Departure" },
];

/**
 * Board of a route's runs for the day, ordered by the chosen sort (most
 * off-schedule, latest, earliest, or departure time). Each row shows the
 * scheduled start, vehicle, stop count, and signed average delay, and links to
 * the run's stop-by-stop timeline.
 * @param props - Board props.
 * @param props.routeId - Route the trips belong to.
 * @param props.trips - The current page of trips, ordered by the active sort.
 * @param props.sort - The active ordering.
 * @param props.isReversed - Whether the active sort direction is reversed from its default.
 * @param props.mode - Route mode, for the heading noun + colour banding.
 * @param props.basePath - Page path the sort + page links point at.
 * @param props.preservedParams - Query params to keep when changing sort/page.
 * @param props.page - The 1-based current page.
 * @param props.totalPages - Total number of pages.
 * @param props.pageSize - Trips per page (sets each row's continuous rank).
 * @param props.liveTripIds - Trip ids currently broadcasting a live position (highlighted).
 * @param props.cancelledTrips - Trips cancelled today, listed atop page 1 with a CANCELLED badge.
 * @returns The board element.
 */
export function WorstTripsBoard({
  routeId,
  trips,
  sort,
  isReversed = false,
  mode,
  basePath,
  preservedParams,
  page,
  totalPages,
  pageSize,
  liveTripIds,
  cancelledTrips = [],
}: WorstTripsBoardProps): JSX.Element {
  const noun = (mode && MODE_NOUN[mode]) ?? "Services";
  // Cancelled trips have no delay to sort by, so they sit at the top of page 1.
  const showCancelled = page === 1 && cancelledTrips.length > 0;
  return (
    <section className="border border-at-border bg-at-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-ultra tracking-zero text-at-ink">{noun} of the day</h2>
        <div className="flex flex-wrap gap-1">
          {SORTS.map((s) => {
            const isActive = s.key === sort;
            // Clicking the active chip toggles direction; clicking an inactive
            // chip switches to it at its default direction (no trev).
            const params = new URLSearchParams({
              ...preservedParams,
              ...(s.key === "off" ? {} : { tsort: s.key }),
            });
            if (isActive && !isReversed) {
              params.set("trev", "1");
            } else {
              params.delete("trev");
            }
            params.delete("tpage");
            const href = params.toString() ? `${basePath}?${params.toString()}` : basePath;
            return (
              <a
                key={s.key}
                href={href}
                className={cn("chip text-xs", isActive ? "chip-on" : "chip-off")}
              >
                {s.label}
                {isActive && <span className="ml-0.5 opacity-60">{isReversed ? "↑" : "↓"}</span>}
              </a>
            );
          })}
        </div>
      </div>
      {trips.length === 0 && !showCancelled ? (
        <p className="text-sm text-at-muted">No trips recorded for this day yet.</p>
      ) : (
        <ol>
          {showCancelled &&
            cancelledTrips.map((c) => (
              <li
                key={`cancelled-${c.trip_id}`}
                className="-mx-4 flex items-center gap-3 border-t border-at-border px-4 py-2.5 text-sm first:border-0"
              >
                <span className="w-6 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-at-muted line-through">
                  {c.headsign ? `to ${c.headsign}` : `Trip ${c.trip_id}`}
                </span>
                <span className="shrink-0 rounded bg-at-late px-1.5 py-0.5 text-xs font-bold text-white">
                  CANCELLED
                </span>
              </li>
            ))}
          {trips.map((t, i) => {
            const avg = t.avg_delay_sec ?? 0;
            const band = delayBand(avg, mode ?? "BUS");
            const valueClass =
              band === "late" ? "text-at-late" : band === "early" ? "text-at-early" : "text-at-ink";
            return (
              <li
                key={t.trip_id}
                className="-mx-4 flex items-center gap-3 border-t border-at-border px-4 py-2.5 text-sm transition-colors first:border-0 hover:bg-at-shore-pale"
              >
                <span className="w-6 shrink-0 text-right text-at-muted tabular-nums">
                  {(page - 1) * pageSize + i + 1}
                </span>
                <a
                  href={`/route/${encodeURIComponent(routeId)}/trip/${encodeURIComponent(t.trip_id)}?d=${encodeURIComponent(t.scheduled_start)}`}
                  className="min-w-0 flex-1 truncate"
                >
                  <span className="font-semibold text-at-shore tabular-nums">
                    {nzClockTime(t.scheduled_start)}
                  </span>
                  <span className="text-at-muted">
                    {t.headsign ? ` to ${t.headsign}` : ""}
                    {t.vehicle_id ? ` · ${t.vehicle_id}` : ""}
                    {" · "}
                    {t.stops} stops
                  </span>
                </a>
                {liveTripIds?.has(t.trip_id) && (
                  <span className="shrink-0 rounded bg-at-ontime px-1.5 py-0.5 text-xs font-bold text-white">
                    LIVE
                  </span>
                )}
                <span className={cn("shrink-0 font-semibold tabular-nums", valueClass)}>
                  {t.avg_delay_sec == null ? "—" : formatDelay(avg)}
                </span>
                <ChevronRight className="shrink-0 text-at-muted" />
              </li>
            );
          })}
        </ol>
      )}
      {totalPages > 1 && (
        <nav
          className="mt-3 flex flex-wrap items-center justify-center gap-1"
          aria-label="Trip pages"
        >
          {page > 1 && (
            <a
              href={pageHref(basePath, preservedParams, sort, page - 1)}
              className="chip chip-off"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </a>
          )}
          {pageWindow(page, totalPages).map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="px-1 text-at-muted">
                …
              </span>
            ) : (
              <a
                key={p}
                href={pageHref(basePath, preservedParams, sort, p)}
                aria-current={p === page ? "page" : undefined}
                className={cn("chip tabular-nums", p === page ? "chip-on" : "chip-off")}
              >
                {p}
              </a>
            ),
          )}
          {page < totalPages && (
            <a
              href={pageHref(basePath, preservedParams, sort, page + 1)}
              className="chip chip-off"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </a>
          )}
        </nav>
      )}
    </section>
  );
}
