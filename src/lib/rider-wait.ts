// src/lib/rider-wait.ts
// Cancellations counted the way a rider feels them. A cancelled trip records no
// arrival, so on arrivals alone it can never be late - cancelling a run quietly
// improves a route's figures. Here a rider who planned on the trip is taken to
// board the next one that ran in the same direction, so every stop the trip
// failed to serve counts as late by that gap. A trip that never ran costs all its
// stops; one cut short costs the stops after the cut; one reinstated costs
// nothing. The penalty joins the measured arrivals in every punctuality figure
// that reads route rows (see applyPenalty).

import type { CancellationStage } from "@/lib/cancellation";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { successorSlug } from "@/lib/route-lineage";
import { routeSlug } from "@/lib/route-slug";
import type { PerTripStat } from "@/types/api";

/**
 * Longest wait one cancellation can cost, in seconds. The last trip of the night
 * has no next trip, and an hourly route's gap is already an hour; past that the
 * rider has found another way.
 */
export const WAIT_CAP_SEC = 3600;

/** A run that recorded arrivals on the day. */
export interface DayRun {
  tripId: string;
  /** Route slug. */
  route: string;
  /** GTFS direction id, or null when unknown. */
  direction: number | null;
  /** Scheduled start, epoch ms. */
  start: number;
  /** Distinct stops with a real arrival. */
  stops: number;
}

/** A flagged trip on the day. */
export interface DayFlag {
  tripId: string;
  /** Route slug. */
  route: string;
  direction: number | null;
  /** Scheduled start, epoch ms, or null when it cannot be told. */
  start: number | null;
  stage: CancellationStage;
}

/** What a route's cancellations add to its figures. */
export interface Penalty {
  /** Stop visits the cancellations removed. */
  events: number;
  /** Sum of the wait over those visits, in seconds. */
  delaySec: number;
  /** Of those visits, how many waited past the late bound. */
  lateEvents: number;
}

/** What one flagged trip adds. */
export interface TripPenalty {
  /** The wait for the next trip, in seconds. */
  waitSec: number;
  /** Stops the trip failed to serve. */
  events: number;
}

/**
 * The median of a list of counts.
 * @param values - The counts.
 * @returns The median rounded to a whole stop, or null for an empty list.
 */
function medianCount(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return Math.round(value ?? 0);
}

/**
 * The rider-wait penalty of a day's cancellations, per route and per trip. The
 * next trip is the first run of the same route and direction scheduled after the
 * flagged one (any direction when the flag's is unknown); a trip's stop count is
 * the median of those runs, since a cancelled trip leaves no count of its own.
 * A flag with no scheduled start, or on a route with no runs to measure against,
 * adds nothing.
 * @param runs - The day's runs.
 * @param flags - The day's flagged trips.
 * @returns Penalties keyed by route slug and by trip id.
 */
export function riderWaitPenalties(
  runs: readonly DayRun[],
  flags: readonly DayFlag[],
): { routes: Record<string, Penalty>; trips: Record<string, TripPenalty> } {
  const groups = new Map<string, DayRun[]>();
  for (const r of runs) {
    for (const key of [`${r.route}|${r.direction ?? "?"}`, `${r.route}|*`]) {
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
  }
  const runById = new Map(runs.map((r) => [r.tripId, r]));
  // A flagged trip is never the next trip, nor a stop count to go by: one that
  // never ran can still carry a leftover prediction row, and one cut short did
  // not serve the stops a rider was waiting at.
  const flaggedIds = new Set(flags.filter((f) => f.stage !== "ran").map((f) => f.tripId));
  const routes: Record<string, Penalty> = {};
  const trips: Record<string, TripPenalty> = {};

  for (const f of flags) {
    if (f.stage === "ran" || f.start === null) continue;
    const start = f.start;
    const group =
      (f.direction !== null ? groups.get(`${f.route}|${f.direction}`) : undefined) ??
      groups.get(`${f.route}|*`);
    const others = (group ?? []).filter((r) => !flaggedIds.has(r.tripId));
    const median = medianCount(others.map((r) => r.stops));
    if (median === null) continue;
    const next = others
      .map((r) => r.start)
      .filter((s) => s > start)
      .sort((a, b) => a - b)[0];
    const waitSec =
      next === undefined ? WAIT_CAP_SEC : Math.min(WAIT_CAP_SEC, (next - start) / 1000);
    const served = f.stage === "mid-trip" ? (runById.get(f.tripId)?.stops ?? 0) : 0;
    const events = Math.max(0, median - served);
    if (events === 0) continue;
    trips[f.tripId] = { waitSec, events };
    const p = (routes[f.route] ??= { events: 0, delaySec: 0, lateEvents: 0 });
    p.events += events;
    p.delaySec += waitSec * events;
    if (waitSec > ON_TIME_LATE_SEC) p.lateEvents += events;
  }
  return { routes, trips };
}

/**
 * Add two penalties.
 * @param a - First penalty.
 * @param b - Second penalty.
 * @returns Their sum.
 */
export function addPenalties(a: Penalty, b: Penalty): Penalty {
  return {
    events: a.events + b.events,
    delaySec: a.delaySec + b.delaySec,
    lateEvents: a.lateEvents + b.lateEvents,
  };
}

/** The punctuality fields a penalty folds into. */
export interface PunctualityFields {
  events: number;
  avg_delay_sec: number | null;
  avg_abs_delay_sec: number | null;
  on_time_pct: number | null;
  early_pct?: number | null;
  late_pct?: number | null;
}

/**
 * Fold a penalty into a row's figures by event weight: the waits join both
 * averages (a wait is late, so it adds the same to the signed and the absolute
 * average), and each penalty visit counts on time or late by its wait. Seconds
 * round to one decimal and shares to one-decimal percent, as the rows do.
 * @param row - The measured figures.
 * @param p - The penalty.
 * @returns The row with the penalty folded in (the same row when there is none).
 */
export function applyPenalty<T extends PunctualityFields>(row: T, p: Penalty | undefined): T {
  if (!p || p.events === 0) return row;
  const e = row.events;
  const total = e + p.events;
  /**
   * Round to one decimal.
   * @param n - The value.
   * @returns The rounded value.
   */
  const round1 = (n: number): number => Math.round(n * 10) / 10;
  /**
   * A share of the combined visits, from a measured share plus penalty visits.
   * @param pct - The measured share, in percent.
   * @param extra - Penalty visits in the share.
   * @returns The combined share, in percent.
   */
  const share = (pct: number | null | undefined, extra: number): number =>
    round1(((((pct ?? 0) / 100) * e + extra) / total) * 100);
  return {
    ...row,
    events: total,
    avg_delay_sec: round1(((row.avg_delay_sec ?? 0) * e + p.delaySec) / total),
    avg_abs_delay_sec: round1(((row.avg_abs_delay_sec ?? 0) * e + p.delaySec) / total),
    on_time_pct: share(row.on_time_pct, p.events - p.lateEvents),
    early_pct: share(row.early_pct, 0),
    late_pct: share(row.late_pct, p.lateEvents),
  };
}

/**
 * Fold each route's penalty into its ranking row. The rows fold a retired train
 * line into its successor (see foldLineageRows), so a penalty keyed by the
 * retired slug follows it there when only the successor has a row.
 * @param rows - Per-route rows, one per line.
 * @param penalties - Route slug to penalty.
 * @returns The rows with their penalties folded in.
 */
export function applyRoutePenalties<T extends PunctualityFields & { route_id: string }>(
  rows: readonly T[],
  penalties: Record<string, Penalty>,
): T[] {
  const slugs = new Set(rows.map((r) => routeSlug(r.route_id)));
  const bySlug: Record<string, Penalty> = {};
  for (const [slug, p] of Object.entries(penalties)) {
    const successor = successorSlug(slug);
    const key = !slugs.has(slug) && successor && slugs.has(successor) ? successor : slug;
    bySlug[key] = bySlug[key] ? addPenalties(bySlug[key], p) : p;
  }
  return rows.map((r) => applyPenalty(r, bySlug[routeSlug(r.route_id)]));
}

/**
 * One route's penalty from a slug-keyed set, including the lines it replaced,
 * since a route page reads its predecessors' history too.
 * @param penalties - Route slug to penalty.
 * @param slug - The route's slug.
 * @returns The route's penalty, or undefined when it has none.
 */
export function penaltyForRoute(
  penalties: Record<string, Penalty>,
  slug: string,
): Penalty | undefined {
  let out: Penalty | undefined;
  for (const [key, p] of Object.entries(penalties)) {
    if (key === slug || successorSlug(key) === slug) out = out ? addPenalties(out, p) : p;
  }
  return out;
}

/**
 * Fold a cut-short run's unserved stops into its own figures, for the trip
 * board: each counts as a delay of the wait for the next trip.
 * @param run - The run as measured.
 * @param p - The run's penalty, when it was cut short.
 * @returns The run with its penalty folded in (the same run when there is none).
 */
export function withTripPenalty<
  T extends Pick<PerTripStat, "stops" | "avg_delay_sec" | "avg_abs_delay_sec" | "worst_delay_sec">,
>(run: T, p: TripPenalty | undefined): T {
  if (!p || p.events === 0) return run;
  const total = run.stops + p.events;
  const extra = p.waitSec * p.events;
  return {
    ...run,
    avg_delay_sec: Math.round((((run.avg_delay_sec ?? 0) * run.stops + extra) / total) * 10) / 10,
    avg_abs_delay_sec:
      Math.round((((run.avg_abs_delay_sec ?? 0) * run.stops + extra) / total) * 10) / 10,
    worst_delay_sec: Math.max(run.worst_delay_sec ?? 0, p.waitSec),
  };
}
