// src/components/WorstTripsBoard.tsx
// Paginated, sortable table of a route's worst trips with delay
// bands. Sort chips reset to page 1 and clicking the active chip toggles its
// direction, while the prev/next page links preserve the active sort so paging
// doesn't drop it. Both are client navigations that keep the scroll position,
// so a sort or page change swaps the board in place instead of reloading the
// document behind the route skeleton. Rows arrive already laid out (see
/// trip-board.ts): cancelled trips carry a CANCELLED badge, and on the delay sorts
// a rank and the wait a rider had for the next trip when that is known; a run AT
// also flagged carries its stage (CANCELLED MID-TRIP, shortened to CUT SHORT on a
// phone, or REINSTATED), a run whose vehicle left its route an OFF ROUTE badge, running
// trips get a LIVE badge, streamed in per row so AT's realtime call never holds
// up the chips or the pager, and ranks stay
// continuous across pages. The section is `min-w-0` because it sits in a grid,
// where it would otherwise grow to its truncating rows' full width on a phone.

import { BadgeKey, type BadgeKeyItem } from "@/components/BadgeKey";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import {
  CANCELLATION_BADGE,
  CANCELLATION_BADGE_CLASS,
  CANCELLATION_BADGE_MEANING,
  CANCELLATION_BADGE_SHORT,
  type CancellationStage,
} from "@/lib/cancellation";
import { cn } from "@/lib/cn";
import type { TripSort } from "@/lib/data";
import { OFF_SCHEDULE_TONE_CLASS, formatDuration, offScheduleValue } from "@/lib/format";
import { MODE_NOUN } from "@/lib/mode";
import { nzClockTime } from "@/lib/time";
import type { TripBoardRow } from "@/lib/trip-board";
import Link from "next/link";
import { type JSX, Suspense } from "react";

/**
 * LIVE badge for one row, resolved from the shared live-vehicle set.
 *
 * The set is passed in unresolved and awaited here, one small boundary per row,
 * so the board itself renders from rows that are already in hand. Awaited a
 * level up it would put the sort chips and the pager behind AT's realtime call:
 * every sort or page click is a server navigation, so the controls that
 * triggered it would vanish into a skeleton until AT answered.
 * @param props - Component props.
 * @param props.tripId - The row's trip id.
 * @param props.liveTripIds - Trip ids currently broadcasting a position.
 * @returns The badge, or null when this run is not live.
 */
async function LiveBadge({
  tripId,
  liveTripIds,
}: {
  tripId: string;
  liveTripIds: Promise<ReadonlySet<string>>;
}): Promise<JSX.Element | null> {
  const ids = await liveTripIds;
  if (!ids.has(tripId)) return null;
  return (
    <span className="shrink-0 rounded bg-at-ontime px-1.5 py-0.5 text-xs font-bold text-white">
      LIVE
    </span>
  );
}

/** Props for {@link WorstTripsBoard}. */
export interface WorstTripsBoardProps {
  /** Route the trips belong to (for the per-trip links). */
  routeId: string;
  /** Service day the rows are from, as `YYYY-MM-DD`. Opens the run on that day. */
  serviceDate: string;
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
  /**
   * Trip ids currently running live; those rows get a LIVE badge. Passed
   * unresolved so the board does not wait on AT's realtime call - see
   * {@link LiveBadge}.
   */
  liveTripIds?: Promise<ReadonlySet<string>>;
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

/**
 * The badges this page of rows actually carries, for the key under the board.
 * Built from the rows rather than from the props, so the key never names a badge
 * that is not on the page in front of the reader.
 * @param rows - The current page of rows.
 * @param detouredTripIds - Trip ids whose vehicle left its route.
 * @returns The key entries, in the order the rows put them.
 */
function badgeKey(
  rows: TripBoardRow[],
  detouredTripIds: ReadonlySet<string> | undefined,
): BadgeKeyItem[] {
  const items: BadgeKeyItem[] = [];
  if (rows.some((r) => r.kind === "run" && detouredTripIds?.has(r.trip.trip_id))) {
    items.push({
      label: "OFF ROUTE",
      className: "bg-at-commercial text-at-ink",
      meaning: "GPS put this vehicle well off its route mid-run",
    });
  }
  const stages = new Set<CancellationStage>(
    rows.flatMap((r) => (r.kind === "cancelled" ? ["before" as const] : (r.cancellation ?? []))),
  );
  for (const stage of ["before", "mid-trip", "ran"] as const) {
    if (!stages.has(stage)) continue;
    items.push({
      label: CANCELLATION_BADGE[stage],
      shortLabel: CANCELLATION_BADGE_SHORT[stage],
      className: CANCELLATION_BADGE_CLASS[stage],
      meaning: CANCELLATION_BADGE_MEANING[stage],
    });
  }
  if (rows.some((r) => r.kind === "cancelled" && r.waitSec !== undefined)) {
    items.push({ label: "wait", meaning: "How long a rider waited for the next trip" });
  }
  return items;
}

/*
  Row layout, shared by the run rows and the cancelled rows so the two kinds line
  their columns up. The link is the whole row, not just the name, so a thumb
  landing on the rank, a badge, the value or the chevron opens the run.
*/
const ROW_CLASS = "border-t border-at-border first:border-0";
const ROW_LINK_CLASS =
  "-mx-4 flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-at-shore-pale";
/*
  Name and badges share a wrapping line. Every badge is `shrink-0`, so with them
  all as siblings of the name the name was the only column that could give, and a
  cancelled run truncated to "32 to Manger...". Here a badge that will not fit
  drops under the name instead, while the value and the chevron stay to the right.
*/
const NAME_GROUP_CLASS = "flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1";
/*
  `min-w-40` is what pushes the badges onto a second line: a `flex-1` item has a
  zero flex basis, so without a floor it would simply shrink and nothing would
  ever wrap. Truncation is still there for a headsign too long for a full row.
*/
const NAME_CLASS = "min-w-40 flex-1 truncate";

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
 * @param props.serviceDate - Service day the rows are from, as `YYYY-MM-DD`.
 * @param props.rows - The current page of rows, in display order.
 * @param props.sort - The active ordering.
 * @param props.isReversed - Whether the active sort direction is reversed from its default.
 * @param props.mode - Route mode, for the heading noun + colour banding.
 * @param props.basePath - Page path the sort + page links point at.
 * @param props.preservedParams - Query params to keep when changing sort/page.
 * @param props.page - The 1-based current page.
 * @param props.totalPages - Total number of pages.
 * @param props.liveTripIds - Unresolved set of trip ids currently broadcasting a position.
 * @param props.detouredTripIds - Trip ids whose vehicle left its route mid-run.
 * @returns The board element.
 */
export function WorstTripsBoard({
  routeId,
  serviceDate,
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
                <li key={`cancelled-${c.trip_id}`} className={ROW_CLASS}>
                  {/* Links to the trip page, which lists the stops the trip would have served.
                      A cancellation AT flagged before the timetable loaded has no scheduled
                      start, so the board's own day stands in; without it the trip page falls
                      back to the run's latest day and opens a different day's run. */}
                  <Link
                    href={`/route/${encodeURIComponent(routeId)}/trip/${encodeURIComponent(c.trip_id)}?d=${encodeURIComponent(c.scheduled_start ?? serviceDate)}`}
                    className={ROW_LINK_CLASS}
                  >
                    <span className="w-6 shrink-0 text-right text-at-muted tabular-nums">
                      {row.rank}
                    </span>
                    <span className={NAME_GROUP_CLASS}>
                      <span className={cn(NAME_CLASS, "text-at-muted line-through")}>
                        {c.scheduled_start && (
                          <span className="font-semibold tabular-nums">
                            {nzClockTime(c.scheduled_start)}{" "}
                          </span>
                        )}
                        {c.headsign ? `to ${c.headsign}` : `Trip ${c.trip_id}`}
                      </span>
                      <span
                        title={CANCELLATION_BADGE_MEANING.before}
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-xs font-bold",
                          CANCELLATION_BADGE_CLASS.before,
                        )}
                      >
                        {CANCELLATION_BADGE.before}
                      </span>
                    </span>
                    {row.waitSec !== undefined && (
                      <span
                        title="A rider waited this long for the next trip"
                        className="shrink-0 font-semibold text-at-late tabular-nums"
                      >
                        {formatDuration(row.waitSec)} wait
                      </span>
                    )}
                    <ChevronRight className="shrink-0 text-at-muted" />
                  </Link>
                </li>
              );
            }
            const t = row.trip;
            const value = offScheduleValue(t.avg_delay_sec, t.avg_abs_delay_sec, mode ?? "BUS");
            return (
              <li key={t.trip_id} className={ROW_CLASS}>
                <Link
                  href={`/route/${encodeURIComponent(routeId)}/trip/${encodeURIComponent(t.trip_id)}?d=${encodeURIComponent(t.scheduled_start)}`}
                  className={ROW_LINK_CLASS}
                >
                  <span className="w-6 shrink-0 text-right text-at-muted tabular-nums">
                    {row.rank}
                  </span>
                  <span className={NAME_GROUP_CLASS}>
                    <span className={NAME_CLASS}>
                      <span className="font-semibold text-at-shore tabular-nums">
                        {nzClockTime(t.scheduled_start)}
                      </span>
                      <span className="text-at-muted">
                        {t.headsign ? ` to ${t.headsign}` : ""}
                        {t.vehicle_id ? ` · ${t.vehicle_id}` : ""}
                        {t.cars ? ` · ${t.cars} cars` : ""}
                        {" · "}
                        {t.stops} stops
                      </span>
                    </span>
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
                        title={CANCELLATION_BADGE_MEANING[row.cancellation]}
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-xs font-bold",
                          CANCELLATION_BADGE_CLASS[row.cancellation],
                        )}
                      >
                        <span className="sm:hidden">
                          {CANCELLATION_BADGE_SHORT[row.cancellation]}
                        </span>
                        <span className="hidden sm:inline">
                          {CANCELLATION_BADGE[row.cancellation]}
                        </span>
                      </span>
                    )}
                    {liveTripIds && (
                      <Suspense fallback={null}>
                        <LiveBadge tripId={t.trip_id} liveTripIds={liveTripIds} />
                      </Suspense>
                    )}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 font-semibold tabular-nums",
                      OFF_SCHEDULE_TONE_CLASS[value.tone],
                    )}
                  >
                    {value.text}
                  </span>
                  <ChevronRight className="shrink-0 text-at-muted" />
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      <BadgeKey items={badgeKey(rows, detouredTripIds)} />
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
