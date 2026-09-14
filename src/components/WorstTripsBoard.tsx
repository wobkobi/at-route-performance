// src/components/WorstTripsBoard.tsx
// Paginated, sortable table of a route's worst trips with delay
// bands. Sort chips reset to page 1 and clicking the active chip toggles its
// direction, while the prev/next page links preserve the active sort so paging
// doesn't drop it. Both are client navigations that keep the scroll position,
// so a sort or page change swaps the board in place instead of reloading the
// document behind the route skeleton. Rows arrive already laid out (see
// trip-board.ts): cancelled trips carry a CANCELLED badge and no rank, a run AT
// also flagged carries its stage (CANCELLED MID-TRIP, shortened to CUT SHORT on a
// phone, or REINSTATED), a run whose vehicle left its route an OFF ROUTE badge, running
// trips get a LIVE badge from the passed-in live id set, and ranks stay
// continuous across pages. The section is `min-w-0` because it sits in a grid,
// where it would otherwise grow to its truncating rows' full width on a phone.

import { ChevronLeft, ChevronRight } from "@/components/icons";
import {
  CANCELLATION_BADGE,
  CANCELLATION_BADGE_SHORT,
  type CancellationStage,
} from "@/lib/cancellation";
import { cn } from "@/lib/cn";
import type { TripSort } from "@/lib/data";
import { formatDelay } from "@/lib/format";
import { MODE_NOUN } from "@/lib/mode";
import { delayBand } from "@/lib/on-time";
import { nzClockTime } from "@/lib/time";
import type { TripBoardRow } from "@/lib/trip-board";
import Link from "next/link";
import type { JSX } from "react";

/** Props for {@link WorstTripsBoard}. */
export interface WorstTripsBoardProps {
  /** Route the trips belong to (for the per-trip links). */
  routeId: string;
  /** The current page of rows (running and cancelled trips), in display order. */
  rows: TripBoardRow[];
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
  /** Trip ids currently running live; those rows get a LIVE badge. */
  liveTripIds?: Set<string>;
  /** Trip ids whose vehicle left its route mid-run; those rows get an OFF ROUTE badge. */
  detouredTripIds?: ReadonlySet<string>;
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

/** Hover text for the cancellation badge on a run, spelling out what the stage means. */
const STAGE_TITLE: Record<CancellationStage, string> = {
  before: "AT cancelled this trip",
  "mid-trip": "AT cancelled this trip after it set off",
  ran: "AT flagged this trip cancelled, then it ran anyway",
};

const SORTS: { key: TripSort; label: string }[] = [
  { key: "off", label: "Most off" },
  { key: "late", label: "Latest" },
  { key: "early", label: "Earliest" },
  { key: "departure", label: "Departure" },
];

/**
 * Board of a route's runs for the day, ordered by the chosen sort (most
 * off-schedule, latest, earliest, or departure time). Each running row shows
 * the scheduled start, vehicle, stop count, and signed average delay, and links
 * to the run's stop-by-stop timeline; a cancelled row shows its scheduled start
 * and destination struck through.
 * @param props - Board props.
 * @param props.routeId - Route the trips belong to.
 * @param props.rows - The current page of rows, in display order.
 * @param props.sort - The active ordering.
 * @param props.isReversed - Whether the active sort direction is reversed from its default.
 * @param props.mode - Route mode, for the heading noun + colour banding.
 * @param props.basePath - Page path the sort + page links point at.
 * @param props.preservedParams - Query params to keep when changing sort/page.
 * @param props.page - The 1-based current page.
 * @param props.totalPages - Total number of pages.
 * @param props.liveTripIds - Trip ids currently broadcasting a live position (highlighted).
 * @param props.detouredTripIds - Trip ids whose vehicle left its route mid-run.
 * @returns The board element.
 */
export function WorstTripsBoard({
  routeId,
  rows,
  sort,
  isReversed = false,
  mode,
  basePath,
  preservedParams,
  page,
  totalPages,
  liveTripIds,
  detouredTripIds,
}: WorstTripsBoardProps): JSX.Element {
  const noun = (mode && MODE_NOUN[mode]) ?? "Services";
  return (
    <section className="min-w-0 border border-at-border bg-at-surface p-4">
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
              <Link
                key={s.key}
                href={href}
                scroll={false}
                className={cn("chip text-xs", isActive ? "chip-on" : "chip-off")}
              >
                {s.label}
                {isActive && <span className="ml-0.5 opacity-60">{isReversed ? "↑" : "↓"}</span>}
              </Link>
            );
          })}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-at-muted">No trips recorded for this day yet.</p>
      ) : (
        <ol>
          {rows.map((row) => {
            if (row.kind === "cancelled") {
              const c = row.trip;
              return (
                <li
                  key={`cancelled-${c.trip_id}`}
                  className="-mx-4 flex items-center gap-3 border-t border-at-border px-4 py-2.5 text-sm transition-colors first:border-0 hover:bg-at-shore-pale"
                >
                  <span className="w-6 shrink-0" />
                  {/* Links to the trip page, which lists the stops the trip would have served. */}
                  <Link
                    href={`/route/${encodeURIComponent(routeId)}/trip/${encodeURIComponent(c.trip_id)}${c.scheduled_start ? `?d=${encodeURIComponent(c.scheduled_start)}` : ""}`}
                    className="min-w-0 flex-1 truncate text-at-muted line-through"
                  >
                    {c.scheduled_start && (
                      <span className="font-semibold tabular-nums">
                        {nzClockTime(c.scheduled_start)}{" "}
                      </span>
                    )}
                    {c.headsign ? `to ${c.headsign}` : `Trip ${c.trip_id}`}
                  </Link>
                  <span className="shrink-0 rounded bg-at-late px-1.5 py-0.5 text-xs font-bold text-white">
                    {CANCELLATION_BADGE.before}
                  </span>
                  <ChevronRight className="shrink-0 text-at-muted" />
                </li>
              );
            }
            const t = row.trip;
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
                  {row.rank}
                </span>
                <Link
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
                </Link>
                {detouredTripIds?.has(t.trip_id) && (
                  <span
                    title="GPS put this vehicle well off its route mid-run"
                    className="shrink-0 rounded bg-at-commercial px-1.5 py-0.5 text-xs font-bold text-at-ink"
                  >
                    OFF ROUTE
                  </span>
                )}
                {row.cancellation && (
                  <span
                    title={STAGE_TITLE[row.cancellation]}
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-xs font-bold",
                      row.cancellation === "ran"
                        ? "border border-at-border text-at-muted"
                        : "bg-at-late text-white",
                    )}
                  >
                    <span className="sm:hidden">{CANCELLATION_BADGE_SHORT[row.cancellation]}</span>
                    <span className="hidden sm:inline">{CANCELLATION_BADGE[row.cancellation]}</span>
                  </span>
                )}
                {liveTripIds?.has(t.trip_id) && (
                  <span className="shrink-0 rounded bg-at-ontime px-1.5 py-0.5 text-xs font-bold text-white">
                    LIVE
                  </span>
                )}
                <span className={cn("shrink-0 font-semibold tabular-nums", valueClass)}>
                  {t.avg_delay_sec == null ? "—" : formatDelay(avg, { mode: mode ?? "BUS" })}
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
            <Link
              href={pageHref(basePath, preservedParams, sort, page - 1)}
              scroll={false}
              className="chip chip-off"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
          )}
          {pageWindow(page, totalPages).map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="px-1 text-at-muted">
                …
              </span>
            ) : (
              <Link
                key={p}
                href={pageHref(basePath, preservedParams, sort, p)}
                scroll={false}
                aria-current={p === page ? "page" : undefined}
                className={cn("chip tabular-nums", p === page ? "chip-on" : "chip-off")}
              >
                {p}
              </Link>
            ),
          )}
          {page < totalPages && (
            <Link
              href={pageHref(basePath, preservedParams, sort, page + 1)}
              scroll={false}
              className="chip chip-off"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
