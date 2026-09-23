// src/lib/stop-closures.ts
// Stop closures and detours, worked out as the realtime ingest sees them happen.
// Three inputs feed one record, the StopClosure collection:
// - AT's alerts, which name stops and routes but no direction, and say what was
//   announced rather than what ran;
// - the feed's SKIPPED stop times, AT's own mark on a run passing a stop, which
//   come with the run's direction;
// - runs seen off their road between two stops (lib/off-route.ts).
// What the buses do outranks what an alert says. A skip or a detour opens as
// suspected on its first run, holds as a trend once enough separate runs show
// it, and ends when enough runs in a row don't. Each row carries the runs for
// and against it, so a poll only adds to them and a missed poll loses nothing.
// Pure: lib/stop-closure-store.ts does the reading and writing.

import type { AtTripUpdates, Trip } from "@/lib/at";
import { cleanAlertHeader, extractText, REROUTE_EFFECTS, type ServiceAlert } from "@/lib/at-alerts";
import { MIN_ARRIVALS_AFTER, MIN_SIGHTINGS } from "@/lib/off-route";
import { parseStartDate } from "@/lib/run-day";
import { nzServiceDayRange, SERVICE_START_HOUR } from "@/lib/time";
import { gtfsTimeSeconds } from "@/lib/trip-id";

/**
 * Separate runs one way that turn a suspected skip or detour into a trend. A
 * starting guess, like the 2-hour window below: review both against the first
 * month's rows, as OPS-C5 does for the ghost-run threshold.
 */
export const TREND_RUNS = 3;

/** The span, in seconds, that {@link TREND_RUNS} runs must fall within. */
export const TREND_WINDOW_SEC = 2 * 3600;

/** Runs in a row that end a seen or skipped state, or put an announced detour in doubt. */
export const CLEAR_RUNS = 3;

/**
 * How far back, in seconds, each poll re-reads runs. A detour is confirmed by
 * the arrivals after it (see lib/off-route.ts), minutes after the run leaves its
 * road, so this only has to outlast that.
 */
export const LOOKBACK_SEC = 90 * 60;

/**
 * How near, in seconds, an off-route reading stops a run's arrival at an
 * announced detour's stop counting as on route.
 */
export const NEAR_READING_SEC = 5 * 60;

/**
 * Seconds a seen or skipped state may go with no run either way before it ends
 * at its last evidence, so a route that stops running can't hold a row open.
 */
export const STALE_SEC = 24 * 3600;

/** Runs kept on a row, each way; the newest are kept. */
export const MAX_MARKS = 12;

/** Two marks on one trip id this far apart are separate runs: AT reuses a trip id every day. */
const SAME_RUN_MS = 12 * 3_600_000;

/** What a row records. */
export type ClosureKind = "closed" | "detour";

/** Where a row's evidence comes from. */
export type ClosureSource = "alert" | "seen" | "skipped";

/** One run's part in a closure: the trip, and when it showed it. */
export interface RunMark {
  tripId: string;
  at: Date;
}

/** One episode, as the StopClosure collection stores it. */
export interface Closure {
  /** Null until stored. */
  id: string | null;
  /** Feed route id; null for an alert naming a stop without a route. */
  routeId: string | null;
  /** Null means both ways. */
  directionId: number | null;
  kind: ClosureKind;
  source: ClosureSource;
  /** The stops closed, or an alert detour's named stops; empty for a seen detour. */
  stopIds: string[];
  /** A seen detour's last stop timed before it left the road. */
  fromStopId: string | null;
  /** A seen detour's first stop timed after it rejoined the road. */
  toStopId: string | null;
  alertId: string | null;
  effect: string | null;
  /** The alert's header; on a seen detour, a reroute alert's header on the route at the time. */
  alert: string | null;
  /** The runs that showed it, oldest first. */
  runs: RunMark[];
  /** The runs since the newest of {@link Closure.runs} that didn't, oldest first. */
  clears: RunMark[];
  /** When a seen or skipped state became a trend. */
  confirmedAt: Date | null;
  /** When enough runs drove an announced detour's stops on route to doubt it. */
  disputedAt: Date | null;
  from: Date;
  /** Null while open. */
  to: Date | null;
}

/** One alert in force on one route: the stops it names there, and when this stint began. */
export interface AlertStint {
  alertId: string;
  routeId: string | null;
  stopIds: string[];
  effect: string;
  header: string | null;
  start: Date;
}

/** One run's stop time in this poll's feed, skipped or timed. */
export interface StopMark {
  routeId: string;
  directionId: number;
  stopId: string;
  tripId: string;
  at: Date;
}

/** One arrival a run recorded. */
export interface TraceArrival {
  stopId: string;
  at: Date;
  /** Whether a vehicle was matched, so the run had positions to be seen off route by. */
  vehicle: boolean;
}

/** One off-route reading of a run. */
export interface TraceReading {
  at: Date;
  /** The reroute alert on the route when the reading was taken. */
  alert: string | null;
}

/** What one recent run did: its real arrivals and its off-route readings. */
export interface RunTrace {
  tripId: string;
  routeId: string;
  directionId: number | null;
  arrivals: TraceArrival[];
  readings: TraceReading[];
}

/** One stretch a run left its road over. */
export interface Excursion {
  fromStopId: string;
  toStopId: string;
  /** The first off-route reading. */
  at: Date;
  alert: string | null;
}

/** Everything one poll decides from. */
export interface ClosureInput {
  now: Date;
  /** The open rows, plus the rows closed within {@link LOOKBACK_SEC}. */
  rows: readonly Closure[];
  /** The alerts in force; null when the alerts feed failed, which leaves alert rows as they are. */
  alerts: readonly AlertStint[] | null;
  skipped: readonly StopMark[];
  served: readonly StopMark[];
  runs: readonly RunTrace[];
}

/**
 * The alerts that close stops or send a route another way, one stint per alert
 * and route. Stop entities are grouped by their route (null for a stop named
 * alone); a DETOUR naming a route and no stops is kept with none, since it still
 * says the route is diverted. A trip entity is about one run, not the stops.
 * @param alerts - The alerts feed.
 * @param now - The current instant.
 * @returns The stints in force now.
 */
export function alertStints(alerts: readonly ServiceAlert[], now: Date): AlertStint[] {
  const ts = now.getTime() / 1000;
  const out: AlertStint[] = [];
  for (const a of alerts) {
    if (!a.id || !a.effect || !REROUTE_EFFECTS.has(a.effect)) continue;
    // The period in force now. An alert with no periods is in force until withdrawn.
    const period =
      a.active_period.length === 0
        ? {}
        : a.active_period.find((p) => (p.start ?? -Infinity) <= ts && ts <= (p.end ?? Infinity));
    if (!period) continue;
    const start = period.start === undefined ? now : new Date(period.start * 1000);
    const text = extractText(a.header_text);
    const header = text ? cleanAlertHeader(text) : null;
    const byRoute = new Map<string | null, Set<string>>();
    for (const e of a.informed_entity) {
      if (e.trip_id) continue;
      if (e.stop_id) {
        const key = e.route_id ?? null;
        byRoute.set(key, (byRoute.get(key) ?? new Set()).add(e.stop_id));
      } else if (e.route_id && a.effect === "DETOUR" && !byRoute.has(e.route_id)) {
        byRoute.set(e.route_id, new Set());
      }
    }
    for (const [routeId, stops] of byRoute) {
      out.push({ alertId: a.id, routeId, stopIds: [...stops], effect: a.effect, header, start });
    }
  }
  return out;
}

/**
 * When a run starts, from its trip descriptor: the start date's GTFS reference
 * (local midnight, four hours before the service day's 4am) plus the start time.
 * @param trip - The trip descriptor.
 * @returns The instant, or null when either field is missing or malformed.
 */
function tripStart(trip: Trip): Date | null {
  const day = parseStartDate(trip.start_date);
  const sec = gtfsTimeSeconds(trip.start_time);
  if (day === null || sec === null) return null;
  const reference = nzServiceDayRange(day).start.getTime() - SERVICE_START_HOUR * 3_600_000;
  return new Date(reference + sec * 1000);
}

/**
 * This poll's skipped and timed stop times. AT lists a planned skip on a run
 * hours before it leaves, so a skip counts only once its run has started, and
 * is dated by the poll since it carries no time. A timed stop counts once its
 * time has passed; a later one is still a prediction. Runs with no direction
 * are left out, since a skip or a detour is one way or the other.
 * @param feed - The trip updates feed.
 * @param now - The current instant.
 * @returns The skipped and the timed stop times.
 */
export function feedMarks(
  feed: AtTripUpdates,
  now: Date,
): { skipped: StopMark[]; served: StopMark[] } {
  const skipped: StopMark[] = [];
  const served: StopMark[] = [];
  for (const e of feed.entity) {
    const tu = e.trip_update;
    const trip = tu?.trip;
    if (!tu || !trip?.trip_id || !trip.route_id || trip.schedule_relationship === 3) continue;
    const directionId = trip.direction_id;
    if (typeof directionId !== "number") continue;
    const stus = Array.isArray(tu.stop_time_update)
      ? tu.stop_time_update
      : tu.stop_time_update
        ? [tu.stop_time_update]
        : [];
    for (const s of stus) {
      if (!s.stop_id) continue;
      const mark = { routeId: trip.route_id, directionId, stopId: s.stop_id, tripId: trip.trip_id };
      if (s.schedule_relationship === 1) {
        const start = tripStart(trip);
        if (start !== null && start <= now) skipped.push({ ...mark, at: now });
        continue;
      }
      const time = s.arrival?.time ?? s.departure?.time;
      if (typeof time === "number" && time * 1000 <= now.getTime()) {
        served.push({ ...mark, at: new Date(time * 1000) });
      }
    }
  }
  return { skipped, served };
}

/**
 * The stretches a run left its road over. Each reading is held to
 * `confirmedDetour`'s rule (after the run's first arrival, and before at least
 * {@link MIN_ARRIVALS_AFTER} more), and readings with no arrival between them
 * form one stretch, which needs {@link MIN_SIGHTINGS} of them. Its ends are the
 * last arrival before its first reading and the first after its last: on the 22
 * Sep detours the stops in between recorded no arrivals at all.
 * @param run - The run.
 * @returns The stretches, in time order.
 */
export function excursions(run: RunTrace): Excursion[] {
  const arrivals = [...run.arrivals].sort((a, b) => a.at.getTime() - b.at.getTime());
  const first = arrivals[0];
  if (!first) return [];
  const kept = [...run.readings]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .filter(
      (r) => r.at > first.at && arrivals.filter((a) => a.at > r.at).length >= MIN_ARRIVALS_AFTER,
    );
  const out: Excursion[] = [];
  let group: TraceReading[] = [];
  /** Close the stretch being built, keeping it when it has enough readings and two ends. */
  const flush = (): void => {
    const head = group[0];
    const tail = group[group.length - 1];
    if (head && tail && group.length >= MIN_SIGHTINGS) {
      const before = arrivals.findLast((a) => a.at < head.at);
      const after = arrivals.find((a) => a.at > tail.at);
      if (before && after && before.stopId !== after.stopId) {
        out.push({
          fromStopId: before.stopId,
          toStopId: after.stopId,
          at: head.at,
          alert: group.find((r) => r.alert)?.alert ?? null,
        });
      }
    }
    group = [];
  };
  for (const r of kept) {
    const prev = group[group.length - 1];
    if (prev && arrivals.some((a) => a.at > prev.at && a.at < r.at)) flush();
    group.push(r);
  }
  flush();
  return out;
}

/**
 * Whether two marks are the same run.
 * @param a - One mark.
 * @param b - The other.
 * @returns True for one trip id within {@link SAME_RUN_MS}.
 */
function sameRun(a: RunMark, b: RunMark): boolean {
  return a.tripId === b.tripId && Math.abs(a.at.getTime() - b.at.getTime()) < SAME_RUN_MS;
}

/**
 * The newest mark's time.
 * @param marks - Marks, oldest first.
 * @returns The time, or null for none.
 */
function newest(marks: readonly RunMark[]): Date | null {
  return marks[marks.length - 1]?.at ?? null;
}

/**
 * Add a run to a list once, keeping it in time order and capped.
 * @param marks - The list, changed in place.
 * @param mark - The run.
 * @returns True when it was added.
 */
function addMark(marks: RunMark[], mark: RunMark): boolean {
  if (marks.some((m) => sameRun(m, mark))) return false;
  marks.push(mark);
  marks.sort((a, b) => a.at.getTime() - b.at.getTime());
  if (marks.length > MAX_MARKS) marks.splice(0, marks.length - MAX_MARKS);
  return true;
}

/**
 * Add a run that showed a row's state. The clears then keep only runs after the
 * newest such run, since they must be the last runs through.
 * @param row - The row, changed in place.
 * @param mark - The run.
 */
function addRun(row: Closure, mark: RunMark): void {
  if (!addMark(row.runs, mark)) return;
  const last = newest(row.runs);
  row.clears = row.clears.filter((c) => last !== null && c.at > last);
}

/**
 * When a row's runs first made a trend: {@link TREND_RUNS} of them within
 * {@link TREND_WINDOW_SEC}.
 * @param runs - The runs, oldest first, one per run.
 * @returns The time of the run that completed it, or null.
 */
function trendAt(runs: readonly RunMark[]): Date | null {
  for (let i = TREND_RUNS - 1; i < runs.length; i++) {
    const last = runs[i];
    const first = runs[i - TREND_RUNS + 1];
    if (last && first && last.at.getTime() - first.at.getTime() <= TREND_WINDOW_SEC * 1000) {
      return last.at;
    }
  }
  return null;
}

/**
 * Whether a run's stretch is the one a seen row records. A shared end is enough,
 * since runs over one detour differ by a stop at most at one end. Otherwise the
 * two overlap in the order the run was timed; a row's end the run was never
 * timed at is taken to lie inside the run's own stretch.
 * @param row - A seen detour row.
 * @param ex - The run's stretch.
 * @param order - The stops the run was timed at, in time order.
 * @returns True when they are the same stretch.
 */
function sameStretch(row: Closure, ex: Excursion, order: readonly string[]): boolean {
  if (row.fromStopId === ex.fromStopId || row.toStopId === ex.toStopId) return true;
  /**
   * A stop's place in the run's order.
   * @param id - The stop.
   * @returns The index, or -1 when the run wasn't timed there.
   */
  const at = (id: string | null): number => (id === null ? -1 : order.indexOf(id));
  const a = at(ex.fromStopId);
  const b = at(ex.toStopId);
  const ra = at(row.fromStopId);
  const rb = at(row.toStopId);
  if (ra < 0 && rb < 0) return false;
  if (ra < 0) return a < rb;
  if (rb < 0) return ra < b;
  return ra < b && a < rb;
}

/**
 * When a run drove a stretch on its road: timed at both ends in order, after
 * `after`, with positions, and no off-route reading between. A run with no
 * vehicle could never have been seen off route, so it proves nothing.
 * @param run - The run.
 * @param fromStopId - The stretch's first end.
 * @param toStopId - Its last end.
 * @param after - Only arrivals after this count.
 * @returns The time at the first end, or null.
 */
function throughAt(run: RunTrace, fromStopId: string, toStopId: string, after: Date): Date | null {
  const a = run.arrivals.find((x) => x.stopId === fromStopId && x.at > after && x.vehicle);
  if (!a) return null;
  const b = run.arrivals.find((x) => x.stopId === toStopId && x.at > a.at);
  if (!b) return null;
  return run.readings.some((r) => r.at >= a.at && r.at <= b.at) ? null : a.at;
}

/**
 * When a run was timed at one of the stops on its road: after `after`, with
 * positions, and no off-route reading within {@link NEAR_READING_SEC}.
 * @param run - The run.
 * @param stopIds - The stops.
 * @param after - Only arrivals after this count.
 * @returns The arrival's time, or null.
 */
function onRouteAt(run: RunTrace, stopIds: readonly string[], after: Date): Date | null {
  const near = NEAR_READING_SEC * 1000;
  const hit = run.arrivals.find(
    (x) =>
      x.vehicle &&
      x.at > after &&
      stopIds.includes(x.stopId) &&
      !run.readings.some((r) => Math.abs(r.at.getTime() - x.at.getTime()) <= near),
  );
  return hit?.at ?? null;
}

/**
 * A new row, empty but for what is given.
 * @param fields - The row's kind, source, start and whatever else it knows.
 * @returns The row, unstored.
 */
function newRow(
  fields: Pick<Closure, "kind" | "source" | "from" | "routeId"> & Partial<Closure>,
): Closure {
  return {
    id: null,
    directionId: null,
    stopIds: [],
    fromStopId: null,
    toStopId: null,
    alertId: null,
    effect: null,
    alert: null,
    runs: [],
    clears: [],
    confirmedAt: null,
    disputedAt: null,
    to: null,
    ...fields,
  };
}

/**
 * A row copied deep enough to change without touching the caller's.
 * @param row - The row.
 * @returns The copy.
 */
function copyRow(row: Closure): Closure {
  return {
    ...row,
    stopIds: [...row.stopIds],
    runs: row.runs.map((m) => ({ ...m })),
    clears: row.clears.map((m) => ({ ...m })),
  };
}

/**
 * Fold one poll's evidence into the rows.
 *
 * Alerts: each stint in force opens a row from the stint's start, or keeps its
 * row up to date; a row whose stint is gone ends now. A stint the feed dropped
 * for a poll reopens its row rather than starting another.
 *
 * Skips: the first run AT marks as skipping a stop one way opens a suspected
 * row; {@link TREND_RUNS} runs within {@link TREND_WINDOW_SEC} confirm it;
 * {@link CLEAR_RUNS} runs timed there since end it at the first of them.
 *
 * Detours seen: the same, for runs that left their road over the same stretch
 * one way ({@link excursions}), cleared by runs that drove it on route.
 *
 * Announced detours: a run that left its road on the route counts for the
 * alert, and {@link CLEAR_RUNS} runs since timed on route at its stops mark it
 * disputed. It stays open: the alert ends it, not the runs.
 *
 * A suspected row with no run for {@link TREND_WINDOW_SEC} ends at its last run,
 * and any seen or skipped row with no evidence either way for
 * {@link STALE_SEC} ends at its last. A run already counted by a row that has
 * ended never opens another.
 * @param input - The rows and this poll's evidence.
 * @returns The rows that are new (`id` null) or changed.
 */
export function reconcileClosures(input: ClosureInput): Closure[] {
  const { now } = input;
  const rows = input.rows.map(copyRow);
  const before = new Map(rows.map((r) => [r, JSON.stringify(r)]));

  if (input.alerts !== null) {
    const live = new Set<string>();
    for (const s of input.alerts) {
      live.add(`${s.alertId}|${s.routeId}`);
      /**
       * Whether a row is this alert's on this route.
       * @param r - The row.
       * @returns True when it is.
       */
      const same = (r: Closure): boolean =>
        r.source === "alert" && r.alertId === s.alertId && r.routeId === s.routeId;
      let row = rows.find((r) => r.to === null && same(r));
      if (!row) {
        row = rows.find((r) => same(r) && r.to !== null && r.to >= s.start);
        if (row) row.to = null;
      }
      const kind: ClosureKind = s.effect === "DETOUR" ? "detour" : "closed";
      if (!row) {
        rows.push(
          newRow({
            kind,
            source: "alert",
            routeId: s.routeId,
            stopIds: [...s.stopIds],
            alertId: s.alertId,
            effect: s.effect,
            alert: s.header,
            from: s.start,
          }),
        );
        continue;
      }
      row.kind = kind;
      row.effect = s.effect;
      row.alert = s.header ?? row.alert;
      row.stopIds = [...s.stopIds];
    }
    for (const r of rows) {
      if (r.to === null && r.source === "alert" && !live.has(`${r.alertId}|${r.routeId}`)) {
        r.to = now;
      }
    }
  }

  for (const m of input.skipped) {
    const mark = { tripId: m.tripId, at: m.at };
    /**
     * Whether a row is this stop's skip, this way.
     * @param r - The row.
     * @returns True when it is.
     */
    const same = (r: Closure): boolean =>
      r.source === "skipped" &&
      r.routeId === m.routeId &&
      r.directionId === m.directionId &&
      r.stopIds[0] === m.stopId;
    const row = rows.find((r) => r.to === null && same(r));
    if (row) addRun(row, mark);
    else if (!rows.some((r) => same(r) && r.runs.some((x) => sameRun(x, mark)))) {
      rows.push(
        newRow({
          kind: "closed",
          source: "skipped",
          routeId: m.routeId,
          directionId: m.directionId,
          stopIds: [m.stopId],
          from: m.at,
          runs: [mark],
        }),
      );
    }
  }

  for (const m of input.served) {
    const row = rows.find(
      (r) =>
        r.to === null &&
        r.source === "skipped" &&
        r.routeId === m.routeId &&
        r.directionId === m.directionId &&
        r.stopIds[0] === m.stopId,
    );
    const last = row ? newest(row.runs) : null;
    const mark = { tripId: m.tripId, at: m.at };
    if (row && last && m.at > last && !row.runs.some((x) => sameRun(x, mark))) {
      addMark(row.clears, mark);
    }
  }

  for (const run of input.runs) {
    const order = [...run.arrivals]
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((a) => a.stopId);
    for (const ex of excursions(run)) {
      const mark = { tripId: run.tripId, at: ex.at };
      for (const r of rows) {
        if (
          r.to === null &&
          r.source === "alert" &&
          r.kind === "detour" &&
          r.routeId === run.routeId &&
          r.from <= ex.at
        ) {
          addRun(r, mark);
        }
      }
      if (run.directionId === null) continue;
      /**
       * Whether a row is this stretch's detour, this way.
       * @param r - The row.
       * @returns True when it is.
       */
      const same = (r: Closure): boolean =>
        r.source === "seen" &&
        r.routeId === run.routeId &&
        r.directionId === run.directionId &&
        sameStretch(r, ex, order);
      const row = rows.find((r) => r.to === null && same(r));
      if (row) {
        addRun(row, mark);
        row.alert ??= ex.alert;
        continue;
      }
      const counted = rows.some(
        (r) =>
          same(r) && (r.runs.some((x) => sameRun(x, mark)) || (r.to !== null && ex.at <= r.to)),
      );
      if (counted) continue;
      rows.push(
        newRow({
          kind: "detour",
          source: "seen",
          routeId: run.routeId,
          directionId: run.directionId,
          fromStopId: ex.fromStopId,
          toStopId: ex.toStopId,
          alert: ex.alert,
          from: ex.at,
          runs: [mark],
        }),
      );
    }
  }

  for (const row of rows) {
    if (row.to !== null) continue;
    if (row.source === "seen" && row.fromStopId && row.toStopId) {
      const last = newest(row.runs);
      if (!last) continue;
      for (const run of input.runs) {
        if (run.routeId !== row.routeId || run.directionId !== row.directionId) continue;
        const at = throughAt(run, row.fromStopId, row.toStopId, last);
        if (at) addMark(row.clears, { tripId: run.tripId, at });
      }
    } else if (row.source === "alert" && row.kind === "detour" && row.stopIds.length > 0) {
      const after = newest(row.runs) ?? row.from;
      for (const run of input.runs) {
        if (run.routeId !== row.routeId) continue;
        const at = onRouteAt(run, row.stopIds, after);
        if (at) addMark(row.clears, { tripId: run.tripId, at });
      }
    }
  }

  for (const row of rows) {
    if (row.to !== null) continue;
    if (row.source === "alert") {
      if (row.kind === "detour") {
        row.disputedAt =
          row.clears.length >= CLEAR_RUNS
            ? (row.disputedAt ?? row.clears[CLEAR_RUNS - 1]?.at ?? null)
            : null;
      }
      continue;
    }
    row.confirmedAt ??= trendAt(row.runs);
    const lastRun = newest(row.runs);
    const firstClear = row.clears[0];
    const lastEvidence = [lastRun, newest(row.clears)].reduce<Date | null>(
      (a, b) => (b !== null && (a === null || b > a) ? b : a),
      null,
    );
    if (firstClear && row.clears.length >= CLEAR_RUNS) row.to = firstClear.at;
    else if (
      row.confirmedAt === null &&
      lastRun &&
      now.getTime() - lastRun.getTime() > TREND_WINDOW_SEC * 1000
    ) {
      row.to = lastRun;
    } else if (lastEvidence && now.getTime() - lastEvidence.getTime() > STALE_SEC * 1000) {
      row.to = lastEvidence;
    }
  }

  return rows.filter((r) => r.id === null || JSON.stringify(r) !== before.get(r));
}
