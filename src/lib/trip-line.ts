// src/lib/trip-line.ts
// The trip page's line: the run's timetabled stops in order, with every stop the
// vehicle was recorded at that the timetable does not list placed where it came
// in time, and each stop and leg given the state the drawing needs. Pure, so the
// placement rules are tested without a page.
import type { CancellationStage } from "@/lib/cancellation";
import type { ScheduledStop } from "@/lib/data/trips";
import type { TripStop } from "@/types/api";

/**
 * What the line knows about a stop.
 * - `recorded`: an arrival was recorded there.
 * - `unrecorded`: timetabled, with no arrival recorded. Polls miss stops, so
 *   this alone says nothing about whether the run called there.
 * - `skipped`: timetabled, unrecorded, in a gap between two recorded stops
 *   where the vehicle was read off its road path - the run went around it.
 * - `not-served`: timetabled past the point a cancelled or cut-short run stopped.
 */
export type LineStopState = "recorded" | "unrecorded" | "skipped" | "not-served";

/** One stop on the line, in the order the drawing lists them. */
export interface LineStop {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  state: LineStopState;
  /** Recorded at a stop this run's timetable does not list: a detour stop. */
  offTimetable: boolean;
  /** The recorded arrival, for a recorded stop. */
  recorded: TripStop | null;
  /** The GTFS departure time, for a timetabled stop. */
  departure_time: string | null;
}

/**
 * A leg of the path the run took, between two line indexes.
 * - `run`: travelled, or presumed travelled on a finished run.
 * - `ahead`: on a live run, past the last stop recorded so far.
 * - `not-served`: into a stop the run never reached.
 */
export interface LineLeg {
  from: number;
  to: number;
  kind: "run" | "ahead" | "not-served";
}

/** The line: its stops, the legs of the path, and the stretches the run went around. */
export interface TripLine {
  stops: LineStop[];
  legs: LineLeg[];
  /** Timetabled stretches the run left: from the stop before a skipped run to the one after. */
  bypasses: Array<{ from: number; to: number }>;
}

/** Inputs to {@link buildTripLine}. */
export interface TripLineInput {
  /** The run's timetabled stops in sequence, or empty when the schedule is unknown. */
  scheduled: readonly ScheduledStop[];
  /** The arrivals recorded for this run and counted as served. */
  recorded: readonly TripStop[];
  /** The cancellation stage when AT flagged the run, else null. */
  stage: CancellationStage | null;
  /** When the vehicle's GPS was read off the trip's road path (epoch ms); empty when it kept to it. */
  offRoute: readonly number[];
  /** Whether the run is on today's service day and may still be moving. */
  live: boolean;
}

/**
 * Build the trip line. A stop the timetable does not list goes after the last
 * recorded timetabled stop scheduled no later than it, so a detour stop sits
 * between the stops it was reached between rather than trailing the list. With
 * no timetable at all, the recorded stops are the line, in their own order.
 * @param input - See {@link TripLineInput}.
 * @returns The stops, the legs of the path and the bypassed stretches.
 */
export function buildTripLine(input: TripLineInput): TripLine {
  const { scheduled, recorded, stage, offRoute, live } = input;
  const byId = new Map(recorded.map((s) => [s.stop_id, s]));
  const listed = new Set(scheduled.map((s) => s.stop_id));
  /**
   * An arrival's scheduled instant, the order stops are placed in.
   * @param s - The arrival.
   * @returns Epoch ms.
   */
  const at = (s: TripStop): number => Date.parse(s.scheduled_at);

  const timetabled = scheduled.map((s) => ({ s, rec: byId.get(s.stop_id) ?? null }));
  const recordedIdx = timetabled.flatMap((t, i) => (t.rec ? [i] : []));
  const lastRec = recordedIdx.at(-1) ?? -1;
  const notServedFrom =
    stage === "before" ? 0 : stage === "mid-trip" ? lastRec + 1 : Number.POSITIVE_INFINITY;

  /**
   * When the vehicle reached a recorded stop.
   * @param s - The arrival.
   * @returns Epoch ms of schedule plus deviation.
   */
  const reached = (s: TripStop): number => at(s) + s.deviation_sec * 1000;

  /**
   * Whether an unrecorded timetabled stop was gone around. Polls miss stops on
   * any run, so a gap counts only when an off-route reading was taken between
   * reaching the recorded stops either side of it.
   * @param i - Its index in the timetable.
   * @returns True when an off-route reading falls inside the gap.
   */
  const inDetourGap = (i: number): boolean => {
    if (offRoute.length === 0) return false;
    const before = recordedIdx.findLast((r) => r < i);
    const after = recordedIdx.find((r) => r > i);
    if (before === undefined || after === undefined) return false;
    const from = reached(timetabled[before]!.rec!);
    const to = reached(timetabled[after]!.rec!);
    return offRoute.some((t) => t >= from && t <= to);
  };

  /**
   * A timetabled stop's state.
   * @param i - Its index in the timetable.
   * @param rec - Its recorded arrival, or null.
   * @returns The state.
   */
  const stateOf = (i: number, rec: TripStop | null): LineStopState => {
    if (rec) return "recorded";
    if (i >= notServedFrom) return "not-served";
    if (inDetourGap(i)) return "skipped";
    return "unrecorded";
  };

  /**
   * A line stop for an arrival the timetable does not list.
   * @param s - The arrival.
   * @returns The stop.
   */
  const offStop = (s: TripStop): LineStop => ({
    stop_id: s.stop_id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    state: "recorded",
    offTimetable: scheduled.length > 0,
    recorded: s,
    departure_time: null,
  });

  // Each off-timetable stop is keyed to the timetabled index it follows (-1: before all).
  const after = new Map<number, TripStop[]>();
  const extras = recorded.filter((s) => !listed.has(s.stop_id)).sort((a, b) => at(a) - at(b));
  for (const x of extras) {
    let slot = -1;
    for (const i of recordedIdx) if (at(timetabled[i]!.rec!) <= at(x)) slot = i;
    after.set(slot, [...(after.get(slot) ?? []), x]);
  }

  const stops: LineStop[] = [...(after.get(-1) ?? []).map(offStop)];
  timetabled.forEach(({ s, rec }, i) => {
    stops.push({
      stop_id: s.stop_id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      state: stateOf(i, rec),
      offTimetable: false,
      recorded: rec,
      departure_time: s.departure_time,
    });
    stops.push(...(after.get(i) ?? []).map(offStop));
  });

  const lastRecordedLine = stops.findLastIndex((s) => s.state === "recorded");
  const path = stops.flatMap((s, i) => (s.state === "skipped" ? [] : [i]));
  const legs: LineLeg[] = [];
  for (let k = 1; k < path.length; k++) {
    const from = path[k - 1]!;
    const to = path[k]!;
    const kind =
      stops[to]!.state === "not-served"
        ? "not-served"
        : live && to > lastRecordedLine
          ? "ahead"
          : "run";
    legs.push({ from, to, kind });
  }

  // A run of skipped stops is bypassed from the trunk stop before it to the one after.
  const bypasses: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < stops.length; i++) {
    if (stops[i]!.state !== "skipped" || stops[i - 1]?.state === "skipped") continue;
    let from = i - 1;
    while (from >= 0 && stops[from]!.offTimetable) from--;
    let to = i;
    while (to < stops.length && (stops[to]!.state === "skipped" || stops[to]!.offTimetable)) to++;
    if (from >= 0 && to < stops.length) bypasses.push({ from, to });
  }

  return { stops, legs, bypasses };
}
