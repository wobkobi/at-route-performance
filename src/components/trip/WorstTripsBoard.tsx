// src/components/trip/WorstTripsBoard.tsx
// Sortable show-more list of a route's worst trips with delay bands. Sort
// chips reset the list to its first rows and clicking the active chip toggles
// its direction, while the show-more link keeps the active sort. Both are
// client navigations that keep the scroll position, so a sort change or a
// longer list swaps the board in place instead of reloading the
// document behind the route skeleton. Rows arrive already laid out (see
// lib/trip/board.ts): cancelled trips carry a CANCELLED badge, and on the delay
// sorts a rank and the wait a rider had for the next trip when that is known; a
// run AT also flagged carries its stage (CANCELLED MID-TRIP, shortened to CUT
// SHORT on a phone, or REINSTATED), a run whose vehicle left its route an OFF
// ROUTE badge, running trips get a LIVE badge, streamed in per row so AT's
// realtime call never holds up the chips or the show-more link. The section is `min-w-0` because it sits in a grid,
// where it would otherwise grow to its truncating rows' full width on a phone.

import { BadgeKey, type BadgeKeyItem } from "@/components/BadgeKey";
import { ChipLink } from "@/components/Chip";
import { ChevronRight } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { TripSort } from "@/lib/data";
import { formatDuration, OFF_SCHEDULE_TONE_CLASS, offScheduleValue, plural } from "@/lib/format";
import { isMode, MODE_NOUN } from "@/lib/mode";
import { LIST_PAGE_SIZE, SHOWN_PARAM } from "@/lib/page/filter-params";
import { tripHref } from "@/lib/page/hrefs";
import { nzClockTime } from "@/lib/time/format";
import { afterMidnightNote, isAfterMidnight } from "@/lib/time/service-day";
import { type TripBoardRow, tripBoardView } from "@/lib/trip/board";
import {
  CANCELLATION_BADGE,
  CANCELLATION_BADGE_CLASS,
  CANCELLATION_BADGE_MEANING,
  CANCELLATION_BADGE_SHORT,
  type CancellationStage,
} from "@/lib/trip/cancellation";
import { boundFor } from "@/lib/trip/departure-label";
import {
  TRIP_NAME_CLASS,
  TRIP_NAME_GROUP_CLASS,
  TRIP_ROW_CLASS,
  TRIP_ROW_LINK_CLASS,
} from "@/lib/trip/row";
import { buildHref } from "@/lib/utils";
import Link from "next/link";
import { type JSX, Suspense } from "react";

/**
 * LIVE badge for one row, resolved from the shared live-vehicle set.
 *
 * The set is passed in unresolved and awaited here, one small boundary per row,
 * so the board itself renders from rows that are already in hand. Awaited a
 * level up it would put the sort chips and the show-more link behind AT's
 * realtime call: every sort or show-more click is a server navigation, so the controls that
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
  /** The rows shown so far (running and cancelled trips), in display order. */
  rows: TripBoardRow[];
  /** How many rows the whole board has. */
  total: number;
  /** Active ordering. */
  sort: TripSort;
  /** Whether the active sort direction is reversed from its default. */
  isReversed?: boolean;
  /** Route mode: heading noun + the mode's early/late colour banding. */
  mode?: string;
  /** Page path the sort and show-more links point at (the route page). */
  basePath: string;
  /** Query params to preserve on the links (`tsort` and `show` are set here). */
  preservedParams: Record<string, string>;
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
 * Tooltip for a run's start time when it falls after midnight, naming the
 * service day the run counts towards.
 * @param iso - The run's scheduled start.
 * @param serviceDate - The board's service day.
 * @returns The tooltip, or undefined before midnight.
 */
function lateNightTitle(iso: string, serviceDate: string): string | undefined {
  return isAfterMidnight(new Date(iso)) ? afterMidnightNote(serviceDate) : undefined;
}

/**
 * The badges the shown rows actually carry, for the key under the board.
 * Built from the rows rather than from the props, so the key never names a badge
 * that is not on the page in front of the reader.
 * @param rows - The rows shown.
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

const SORTS: { key: TripSort; label: string }[] = [
  { key: "off", label: "Most off" },
  { key: "late", label: "Latest" },
  { key: "early", label: "Earliest" },
  { key: "departure", label: "Departure" },
];

/**
 * What the active sort actually ranks on, which the chips alone cannot say:
 * "Most off" orders by distance and the other two by the signed average, so one
 * run can top the first board and sit at the bottom of the second. Worded as
 * the key rather than the direction, so reversing a sort cannot make the line
 * untrue.
 */
const SORT_NOTE: Record<TripSort, string> = {
  off: "Ranked on distance from schedule, so a run 9m early sits beside one 9m late.",
  late: "Ranked on the signed average, so a run 9m early sits at the opposite end from one 9m late.",
  early:
    "Ranked on the signed average, so a run 9m early sits at the opposite end from one 9m late.",
  departure: "In scheduled departure order.",
};

/**
 * Board of a route's runs for the day, ordered by the chosen sort (most
 * off-schedule, latest, earliest, or departure time). Each running row shows
 * the scheduled start, vehicle, stop count, and signed average delay, and links
 * to the run's stop-by-stop timeline; a cancelled row shows its scheduled start
 * and destination struck through.
 * @param props - Board props.
 * @param props.routeId - Route the trips belong to.
 * @param props.serviceDate - Service day the rows are from, as `YYYY-MM-DD`.
 * @param props.rows - The rows shown so far, in display order.
 * @param props.total - How many rows the whole board has.
 * @param props.sort - The active ordering.
 * @param props.isReversed - Whether the active sort direction is reversed from its default.
 * @param props.mode - Route mode, for the heading noun + colour banding.
 * @param props.basePath - Page path the sort and show-more links point at.
 * @param props.preservedParams - Query params to keep when changing the sort or length.
 * @param props.liveTripIds - Unresolved set of trip ids currently broadcasting a position.
 * @param props.detouredTripIds - Trip ids whose vehicle left its route mid-run.
 * @returns The board element.
 */
export function WorstTripsBoard({
  routeId,
  serviceDate,
  rows,
  total,
  sort,
  isReversed = false,
  mode,
  basePath,
  preservedParams,
  liveTripIds,
  detouredTripIds,
}: WorstTripsBoardProps): JSX.Element {
  const noun = isMode(mode) ? MODE_NOUN[mode] : "Services";
  // The board as it stands, for a run's link to hand back to this page.
  const tsort = sort === "off" ? undefined : sort;
  const view = tripBoardView({
    ...preservedParams,
    tsort,
    [SHOWN_PARAM]: rows.length > LIST_PAGE_SIZE ? String(rows.length) : undefined,
  });
  /**
   * A run's trip page, carrying the board's view for the way back.
   * @param tripId - The run's trip id.
   * @param at - The run's instant, or its service day when it has none.
   * @returns The href.
   */
  const runHref = (tripId: string, at: string): string => tripHref(routeId, tripId, at, view);
  return (
    <section className="min-w-0 border border-at-border bg-at-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-ultra tracking-zero text-at-ink">{noun} of the day</h2>
        <div className="flex flex-wrap gap-1">
          {SORTS.map((s) => {
            const isActive = s.key === sort;
            // Clicking the active chip toggles direction; clicking an inactive
            // chip switches to it at its default direction (no trev).
            const href = buildHref(basePath, {
              ...preservedParams,
              tsort: s.key === "off" ? undefined : s.key,
              trev: isActive && !isReversed ? "1" : undefined,
            });
            return (
              <ChipLink key={s.key} href={href} active={isActive} className="text-xs">
                {s.label}
                {isActive && <span className="ml-0.5 opacity-60">{isReversed ? "↑" : "↓"}</span>}
              </ChipLink>
            );
          })}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-at-muted">No trips recorded for this day yet.</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-at-muted">{SORT_NOTE[sort]}</p>
          <ol className="striped">
            {rows.map((row) => {
              if (row.kind === "cancelled") {
                const c = row.trip;
                return (
                  <li key={`cancelled-${c.trip_id}`} className={TRIP_ROW_CLASS}>
                    {/* Links to the trip page, which lists the stops the trip would have served.
                      A cancellation AT flagged before the timetable loaded has no scheduled
                      start, so the board's own day stands in; without it the trip page falls
                      back to the run's latest day and opens a different day's run. */}
                    <Link
                      href={runHref(c.trip_id, c.scheduled_start ?? serviceDate)}
                      className={TRIP_ROW_LINK_CLASS}
                    >
                      <span className="w-6 shrink-0 text-right text-at-muted tabular-nums">
                        {row.rank}
                      </span>
                      <span className={TRIP_NAME_GROUP_CLASS}>
                        <span className={cn(TRIP_NAME_CLASS, "text-at-muted line-through")}>
                          {c.scheduled_start && (
                            <span
                              className="font-semibold tabular-nums"
                              title={lateNightTitle(c.scheduled_start, serviceDate)}
                            >
                              {nzClockTime(c.scheduled_start)}{" "}
                            </span>
                          )}
                          {boundFor(c.headsign, mode ?? "BUS") ?? `Trip ${c.trip_id}`}
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
              const bound = boundFor(t.headsign, mode ?? "BUS");
              return (
                <li key={t.trip_id} className={TRIP_ROW_CLASS}>
                  <Link
                    href={runHref(t.trip_id, t.scheduled_start)}
                    className={TRIP_ROW_LINK_CLASS}
                  >
                    <span className="w-6 shrink-0 text-right text-at-muted tabular-nums">
                      {row.rank}
                    </span>
                    <span className={TRIP_NAME_GROUP_CLASS}>
                      <span className={TRIP_NAME_CLASS}>
                        <span
                          className="font-semibold text-at-shore tabular-nums"
                          title={lateNightTitle(t.scheduled_start, serviceDate)}
                        >
                          {nzClockTime(t.scheduled_start)}
                        </span>
                        <span className="text-at-muted">
                          {bound ? ` ${bound}` : ""}
                          {t.vehicle_id ? ` · ${t.vehicle_id}` : ""}
                          {t.cars ? ` · ${t.cars} cars` : ""}
                          {" · "}
                          {plural(t.stops, "stop")}
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
        </>
      )}
      <BadgeKey items={badgeKey(rows, detouredTripIds)} />
      {rows.length < total && (
        <div className="mt-3 flex justify-center">
          <Link
            href={buildHref(basePath, {
              ...preservedParams,
              tsort,
              [SHOWN_PARAM]: String(rows.length + LIST_PAGE_SIZE),
            })}
            scroll={false}
            className="chip chip-off"
          >
            Show {Math.min(LIST_PAGE_SIZE, total - rows.length)} more of {total - rows.length}
          </Link>
        </div>
      )}
    </section>
  );
}
