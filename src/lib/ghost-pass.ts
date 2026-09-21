// src/lib/ghost-pass.ts
// Nightly classification of a completed service day's arrival events into real
// readings and ghost re-reports (AT reusing a `trip_id` against a later vehicle
// block). Ingest stores every reading as reported, so this is what keeps the
// noise out of the stats without a magnitude cut deleting the worst genuine
// delays along with it - see deviation.ts for the rule.
//
// Runs off the `(scheduledAt, tripId)` index: one aggregation reduces the day to
// a level per trip, then batched multi-updates rewrite each trip's `ghost` flag
// from that level. No reading is deleted, every row of a trip is re-decided in
// the same write, and a re-run reaches the same verdicts, so the pass is
// idempotent without ever clearing a day's flags first.
//
// A second rule catches what the level cannot: a run whose every reading sits a
// vehicle cycle off the schedule it is filed under agrees with itself, so the
// level clears it. The whole-run rule hides such a run outright and records why
// in GhostRun, reading trip metadata by `_id` range for the handful of runs a
// night whose shape could qualify.
import { prisma, runCommand, throwOnWriteErrors } from "@/lib/db";
import { GHOST_GAP_SEC } from "@/lib/deviation";
import { serviceDayClockSeconds, type DateRange } from "@/lib/time";
import { tripIdPrefix, tripIdStartSeconds, tripIdVariantHash } from "@/lib/trip-id";
import type { Prisma } from "@prisma/client";

/** Trips per bulk `update` command (well under Mongo's 1000-op cap). */
export const UPDATE_BATCH = 500;

/**
 * Rows the level aggregation may return in one batch. A day holds a few tens
 * of thousands of trips at roughly sixty bytes each, far under the 16 MB reply
 * limit; the pass refuses a reply that fills the batch rather than classify a
 * silently truncated day.
 */
const LEVEL_BATCH_SIZE = 100_000;

/**
 * Trip slots one sibling lookup will read. A prefix covers every day type of
 * one pattern, not one block's day: across the 811 prefixes in trip metadata on
 * 19 September 2026 the average was 77 slots and the largest 1,210. The bound
 * leaves room above that and only stops a malformed prefix walking the index; a
 * lookup that fills it is logged rather than read as complete.
 */
const SIBLING_SCAN_LIMIT = 5000;

/**
 * How far a run's own scheduled start may sit from the schedule its earliest
 * stored reading was filed against before the anchor test fires. Over all 15,277
 * trip-days on 2026-09-14 the circular anchor put 14,578 within two minutes and
 * exactly one above half an hour, at a full cycle.
 */
export const ANCHOR_GAP_SEC = 1800;

/** How near a silent sibling's start must sit to the readings' physical time. */
export const SIBLING_GAP_SEC = 600;

/**
 * How near a reporting trip must sit to a silent sibling before it proves the
 * sibling's pattern ran that day. An hour either side, which is a full slot on
 * the hourly patterns the rule is written against.
 */
export const NEIGHBOUR_GAP_SEC = 3600;

/** Fewest stops a run needs before the whole-run rule may fire. */
export const MIN_GHOST_RUN_STOPS = 3;

/** Runs hidden in one night above which the pass shouts. */
export const GHOST_RUN_ALERT = 20;

/**
 * Circular distance modulo a day between a run's own start and the seconds of
 * service day its earliest stored reading falls at. The circular form is not
 * optional: measured plainly, the dozen runs a night starting just before the
 * boundary have readings filed either side of it and read as ~86,000 s off their
 * own start, where wrapped they read as the two minutes they really are. A run
 * stored against its own schedule has an anchor of zero.
 * @param startSec - The run's scheduled start, seconds past the GTFS reference.
 * @param firstScheduledSec - Seconds of service day of the earliest stored reading.
 * @returns The wrapped distance in seconds, 0 to 43,200.
 */
export function anchorGapSec(startSec: number, firstScheduledSec: number): number {
  const d = Math.abs((startSec % 86_400) - (firstScheduledSec % 86_400)) % 86_400;
  return Math.min(d, 86_400 - d);
}

/** One run, reduced to what the whole-run rule needs. */
export interface GhostRunCandidate {
  tripId: string;
  routeId: string;
  vehicleId: string | null;
  /** Distinct stops with a reading. */
  stops: number;
  /** Smallest per-stop best in the run by magnitude, seconds. */
  minAbsSec: number;
  /** The run's level: the median per-stop best, seconds. */
  levelSec: number;
  /** Earliest stored `scheduledAt` of the run. */
  firstScheduled: Date;
  /** The service day's start instant. */
  dayStart: Date;
}

/** What the whole-run rule decided. */
export interface GhostRunVerdict {
  ghost: boolean;
  /** Which tests fired, in the order they were checked. */
  evidence: string[];
  belongsToTripId: string | null;
}

/**
 * The necessary shape for the whole-run rule: at least
 * {@link MIN_GHOST_RUN_STOPS} stops and not one reading within
 * {@link GHOST_GAP_SEC} of the schedule it is stored against. This is the
 * condition the per-reading pass cannot express, because that one only measures
 * spread inside a run. It is never sufficient on its own - nothing is hidden on
 * shape alone - and it is checked first so the silent-sibling lookup costs an
 * index range only for the handful of runs a night that could possibly qualify.
 * @param c - The run reduced to the rule's inputs.
 * @returns Whether the run may be considered at all.
 */
export function wholeGhostShape(c: GhostRunCandidate): boolean {
  return c.stops >= MIN_GHOST_RUN_STOPS && c.minAbsSec > GHOST_GAP_SEC;
}

/**
 * Whether every reading of a run belongs to another run's block. The shape from
 * {@link wholeGhostShape} is necessary but never sufficient, so at least one
 * corroborating test must fire. A genuinely late run keeps its own anchor: its
 * delay is measured against its own schedule, so the earliest stored schedule
 * equals the run's own start and the anchor test cannot fire for it. That is the
 * discriminator, and it is empirically sharp - the whole rule fires once in
 * 69,423 trip-days across the five days measured.
 * @param c - The run reduced to the rule's inputs.
 * @param sibling - The trip id the silent-sibling test named, or null.
 * @returns Whether to hide the run, with the evidence and the named run.
 */
export function isWholeGhostRun(c: GhostRunCandidate, sibling: string | null): GhostRunVerdict {
  const none: GhostRunVerdict = { ghost: false, evidence: [], belongsToTripId: null };
  if (!wholeGhostShape(c)) return none;
  const startSec = tripIdStartSeconds(c.tripId);
  if (startSec === null) return none;

  const evidence: string[] = [];
  const firstSec = serviceDayClockSeconds(c.dayStart, c.firstScheduled);
  if (anchorGapSec(startSec, firstSec) > ANCHOR_GAP_SEC) evidence.push("anchor");
  if (sibling !== null) evidence.push("silent-sibling");

  return { ghost: evidence.length > 0, evidence, belongsToTripId: sibling };
}

/** One trip slot of a block, for the silent-sibling test. */
export interface TripSlot {
  tripId: string;
  /** Its scheduled start, seconds past the GTFS reference. */
  startSec: number;
  /** Whether it reported anything on the service day being classified. */
  reported: boolean;
}

/**
 * The trip whose slot a displaced run's readings actually describe, when one can
 * be named: a sibling of the same block that reported nothing, whose own start
 * sits within {@link SIBLING_GAP_SEC} of the physical time the readings describe,
 * and whose timetable pattern is proved to have run by a reporting trip of the
 * same variant hash within {@link NEIGHBOUR_GAP_SEC}.
 *
 * The physical time is the earliest stored schedule plus the run's level, not
 * the run's own start plus its level, which would count the displacement twice.
 * The hash clause is load-bearing rather than tidy: four trip ids share start
 * 81900 under prefix `1108-15203`, and only one belongs to the pattern that ran.
 *
 * The test is strict enough that it fires on nothing in the data held so far, so
 * treat it as a naming aid rather than a second gate.
 * @param candidate - The displaced run.
 * @param siblings - Every slot of the run's own block, with whether it reported.
 * @returns The named trip id, or null when nothing qualifies.
 */
export function findSilentSibling(
  candidate: GhostRunCandidate,
  siblings: readonly TripSlot[],
): string | null {
  const physicalSec =
    serviceDayClockSeconds(candidate.dayStart, candidate.firstScheduled) + candidate.levelSec;
  const reported = siblings.filter((s) => s.reported && s.tripId !== candidate.tripId);

  for (const slot of siblings) {
    if (slot.reported || slot.tripId === candidate.tripId) continue;
    if (anchorGapSec(slot.startSec, physicalSec) > SIBLING_GAP_SEC) continue;
    const hash = tripIdVariantHash(slot.tripId);
    if (hash === null) continue;
    const proved = reported.some(
      (r) =>
        tripIdVariantHash(r.tripId) === hash &&
        anchorGapSec(r.startSec, slot.startSec) <= NEIGHBOUR_GAP_SEC,
    );
    if (proved) return slot.tripId;
  }
  return null;
}

/**
 * A `scheduledAt` window in extended JSON, as raw commands take it. A type
 * alias rather than an interface so it satisfies the JSON shape raw commands
 * accept (interfaces carry no implicit index signature).
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- needs the implicit index signature
export type BsonWindow = {
  $gte: { $date: string };
  $lt: { $date: string };
};

/** One trip's run level for the day. */
export interface TripLevel {
  tripId: string;
  /** Median of the trip's best reading per stop, in seconds. */
  level: number;
}

/** One entry of a bulk `update` command (an alias, see {@link BsonWindow}). */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- needs the implicit index signature
export type GhostUpdateOp = {
  q: Prisma.InputJsonObject;
  u: Prisma.InputJsonObject[];
  multi: true;
};

/** What a pass did, for the ingest log. */
export interface GhostPassResult {
  /** Trips examined. */
  trips: number;
  /** Event rows carrying a ghost flag once the pass finished. */
  flagged: number;
  /** Runs hidden outright by the whole-run rule. */
  hidden: number;
}

/** One hidden run, as the pass records it. */
export interface GhostRunRecord {
  tripId: string;
  serviceDate: string;
  routeId: string;
  levelSec: number;
  readings: number;
  vehicleId: string | null;
  belongsToTripId: string | null;
  evidence: string[];
}

/** Where one pass reads and writes, so a test can point it at scratch collections. */
export interface GhostPassTarget {
  /** The events collection. */
  events?: string;
  /** The collection hidden runs are recorded in. */
  runs?: string;
  /** The trip metadata collection the silent-sibling test reads. */
  meta?: string;
}

/** One row of the level aggregation's reply. */
interface LevelRow {
  _id: string;
  level: number;
  firstScheduled: { $date: string } | string;
  minAbs: number;
  stops: number;
  routeId: string;
  vehicleId?: string | null;
}

/**
 * The window a service day's rows fall in, in extended JSON.
 * @param range - The service-day window.
 * @returns The `$gte`/`$lt` bounds.
 */
export function bsonWindow(range: DateRange): BsonWindow {
  return { $gte: { $date: range.start.toISOString() }, $lt: { $date: range.end.toISOString() } };
}

/**
 * Pipeline stages reducing arrival rows to one row per trip: its level, and the
 * inputs the whole-run rule needs. Each stop contributes only its reading
 * nearest that stop's own schedule, so a stop carrying both a real arrival and a
 * ghost re-report contributes the real one (`$top` keeps the signed value while
 * ranking on magnitude; a plain `$min` would return the magnitude and read a
 * uniformly early run as a late one). The level is the exact median of those
 * per-stop readings, the element at `floor(n / 2)` of the sorted list, which is
 * the same element `medianDeviation` in deviation.ts picks for the in-memory
 * path, so the two paths agree on a run's level.
 *
 * `stops` counts distinct stops rather than rows, because the per-stop group has
 * already collapsed a visit's re-reports into one best, and `minAbs` is the
 * nearest any reading of the run got to the schedule it is filed against - the
 * necessary condition of the whole-run rule. `$min` skips null and missing, so a
 * run whose readings carry no vehicle id resolves `vehicleId` to null rather
 * than dropping the row. Platforms are grouped by stop rather than by station: a
 * ghost sits a whole vehicle cycle off the run, so it clears the gap from either
 * platform, and grouping by stop keeps the pass off the Stop collection
 * entirely. Exported without the `$match` so a test can feed the stages
 * synthetic rows through `$documents`.
 * @returns The stages, to follow a `$match` on the day.
 */
export function ghostLevelStages(): Prisma.InputJsonObject[] {
  return [
    { $addFields: { absDev: { $abs: "$deviationSec" } } },
    {
      $group: {
        _id: { tripId: "$tripId", stopId: "$stopId" },
        best: { $top: { sortBy: { absDev: 1 }, output: "$deviationSec" } },
        sched: { $min: "$scheduledAt" },
        route: { $min: "$routeId" },
        veh: { $min: "$vehicleId" },
      },
    },
    {
      $group: {
        _id: "$_id.tripId",
        deviations: { $push: "$best" },
        firstScheduled: { $min: "$sched" },
        minAbs: { $min: { $abs: "$best" } },
        stops: { $sum: 1 },
        routeId: { $min: "$route" },
        vehicleId: { $min: "$veh" },
      },
    },
    {
      $project: {
        _id: 1,
        firstScheduled: 1,
        minAbs: 1,
        stops: 1,
        routeId: 1,
        vehicleId: 1,
        level: {
          $arrayElemAt: [
            { $sortArray: { input: "$deviations", sortBy: 1 } },
            { $toInt: { $floor: { $divide: [{ $size: "$deviations" }, 2] } } },
          ],
        },
      },
    },
  ];
}

/**
 * The full level aggregation for one service day.
 * @param window - The day's `scheduledAt` window.
 * @returns The pipeline.
 */
export function ghostPassPipeline(window: BsonWindow): Prisma.InputJsonObject[] {
  return [{ $match: { scheduledAt: window } }, ...ghostLevelStages()];
}

/**
 * The bulk-update entries that rewrite a trip's flags: every row of the trip in
 * the window is decided in one multi-update. A run the whole-run rule hid takes
 * `ghost: true` outright - its readings agree with each other, so the level rule
 * would clear every one of them. Every other trip is decided from its level:
 * `ghost: true` when a reading sits more than {@link GHOST_GAP_SEC} off it
 * (exclusive, as `isGhostDeviation` is) and the field removed otherwise.
 * Rewriting both ways in one write is what makes a re-run safe with no clearing
 * step, and keeps every trip's rows consistent with each other at any instant.
 * Batched at {@link UPDATE_BATCH} trips per command.
 * @param levels - The day's trip levels.
 * @param window - The day's `scheduledAt` window.
 * @param hidden - Trip ids the whole-run rule hid.
 * @returns The update batches, in trip order.
 */
export function ghostUpdateBatches(
  levels: readonly TripLevel[],
  window: BsonWindow,
  hidden: ReadonlySet<string> = new Set(),
): GhostUpdateOp[][] {
  const ops = levels.map(({ tripId, level }): GhostUpdateOp => ({
    q: { tripId, scheduledAt: window },
    u: hidden.has(tripId)
      ? [{ $set: { ghost: true } }]
      : [
          {
            $set: {
              ghost: {
                $cond: [
                  {
                    $or: [
                      { $gt: ["$deviationSec", level + GHOST_GAP_SEC] },
                      { $lt: ["$deviationSec", level - GHOST_GAP_SEC] },
                    ],
                  },
                  true,
                  "$$REMOVE",
                ],
              },
            },
          },
        ],
    multi: true,
  }));
  const batches: GhostUpdateOp[][] = [];
  for (let i = 0; i < ops.length; i += UPDATE_BATCH) batches.push(ops.slice(i, i + UPDATE_BATCH));
  return batches;
}

/**
 * An extended-JSON date from a raw reply as a Date.
 * @param v - The raw field value.
 * @returns The instant.
 */
function bsonDate(v: { $date: string } | string): Date {
  return new Date(typeof v === "string" ? v : v.$date);
}

/**
 * The upsert entries that record a day's hidden runs, keyed on the unique
 * `(tripId, serviceDate)` so a re-run rewrites rather than duplicates.
 * @param records - The runs hidden this pass.
 * @returns The update entries.
 */
export function ghostRunWriteOps(records: readonly GhostRunRecord[]): Prisma.InputJsonObject[] {
  return records.map((r) => ({
    q: { tripId: r.tripId, serviceDate: r.serviceDate },
    u: { $set: { ...r } },
    upsert: true,
  }));
}

/**
 * Every trip slot of one run's block, with whether it reported on the day being
 * classified. Reads the prefix range off the metadata collection's `_id` index,
 * one index range per candidate, and only for candidates that already passed
 * {@link wholeGhostShape}. The batch size matches the limit so the first batch
 * holds the whole range: a `find` otherwise stops its first batch at 101
 * documents, which a quarter of the prefixes exceed.
 * @param tripId - The candidate run's trip id.
 * @param reported - Trip ids that recorded at least one reading in the window.
 * @param collection - The trip metadata collection.
 * @returns The block's slots, in whatever order the index returns them.
 */
async function blockSlots(
  tripId: string,
  reported: ReadonlySet<string>,
  collection: string,
): Promise<TripSlot[]> {
  const prefix = tripIdPrefix(tripId);
  if (prefix === null) return [];
  const res = (await runCommand(() =>
    prisma.$runCommandRaw({
      find: collection,
      filter: { _id: { $gte: prefix, $lt: `${prefix}￿` } },
      projection: { _id: 1 },
      limit: SIBLING_SCAN_LIMIT,
      batchSize: SIBLING_SCAN_LIMIT,
    }),
  )) as unknown as { cursor: { firstBatch: { _id: string }[] } };
  const ids = res.cursor.firstBatch;
  if (ids.length >= SIBLING_SCAN_LIMIT) {
    console.warn("[GHOST] Sibling lookup hit its bound, so some slots went unread", {
      tripId,
      prefix,
      limit: SIBLING_SCAN_LIMIT,
    });
  }
  const slots: TripSlot[] = [];
  for (const { _id } of ids) {
    const startSec = tripIdStartSeconds(_id);
    if (startSec !== null) slots.push({ tripId: _id, startSec, reported: reported.has(_id) });
  }
  return slots;
}

/**
 * Flag the ghost readings in a completed service day, and hide any run whose
 * every reading belongs to another run's block.
 * @param range - The service-day window to classify.
 * @param serviceDate - Its service date (`YYYY-MM-DD`), as stored on a hidden run.
 * @param target - Collections to read and write (a test points these at scratch ones).
 * @returns Counts of trips examined, rows flagged and runs hidden.
 */
export async function classifyGhosts(
  range: DateRange,
  serviceDate: string,
  target: GhostPassTarget = {},
): Promise<GhostPassResult> {
  const { events = "ArrivalEvent", runs = "GhostRun", meta = "tripMeta" } = target;
  const window = bsonWindow(range);

  const res = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: events,
      pipeline: ghostPassPipeline(window),
      cursor: { batchSize: LEVEL_BATCH_SIZE },
    }),
  )) as unknown as { cursor: { firstBatch: LevelRow[] } };
  if (res.cursor.firstBatch.length >= LEVEL_BATCH_SIZE) {
    throw new Error(
      `ghost pass: the day holds ${LEVEL_BATCH_SIZE} or more trips, more than one batch returns`,
    );
  }
  const rows = res.cursor.firstBatch;
  const levels: TripLevel[] = rows.map((t) => ({ tripId: t._id, level: t.level }));
  const reported = new Set(levels.map((l) => l.tripId));

  // The whole-run rule. The shape test comes first so the sibling lookup costs
  // an index range only for the handful of runs a night that could qualify at
  // all - one in 69,423 trip-days fires across the days measured.
  const records: GhostRunRecord[] = [];
  for (const row of rows) {
    const candidate: GhostRunCandidate = {
      tripId: row._id,
      routeId: row.routeId,
      vehicleId: row.vehicleId ?? null,
      stops: row.stops,
      minAbsSec: row.minAbs,
      levelSec: row.level,
      firstScheduled: bsonDate(row.firstScheduled),
      dayStart: range.start,
    };
    if (!wholeGhostShape(candidate)) continue;
    const sibling = findSilentSibling(candidate, await blockSlots(row._id, reported, meta));
    const verdict = isWholeGhostRun(candidate, sibling);
    if (!verdict.ghost) continue;
    records.push({
      tripId: candidate.tripId,
      serviceDate,
      routeId: candidate.routeId,
      levelSec: candidate.levelSec,
      readings: candidate.stops,
      vehicleId: candidate.vehicleId,
      belongsToTripId: verdict.belongsToTripId,
      evidence: verdict.evidence,
    });
  }
  const hidden = new Set(records.map((r) => r.tripId));

  // One multi-update per trip, batched, so a day costs tens of round-trips
  // rather than thousands. A batch continues past a failed entry (`ordered:
  // false`), so the reply's write errors are checked rather than the promise.
  for (const updates of ghostUpdateBatches(levels, window, hidden)) {
    const out = await runCommand(() =>
      prisma.$runCommandRaw({ update: events, updates, ordered: false }),
    );
    throwOnWriteErrors(out, [], "ghost pass update");
  }

  // Records for the day are rewritten rather than accumulated: a re-run that no
  // longer hides a run must leave no row claiming it did.
  const cleared = await runCommand(() =>
    prisma.$runCommandRaw({
      delete: runs,
      deletes: [{ q: { serviceDate, tripId: { $nin: [...hidden] } }, limit: 0 }],
    }),
  );
  throwOnWriteErrors(cleared, [], "GhostRun clear");
  if (records.length > 0) {
    const out = await runCommand(() =>
      prisma.$runCommandRaw({ update: runs, updates: ghostRunWriteOps(records), ordered: false }),
    );
    throwOnWriteErrors(out, [], "GhostRun upsert");
  }
  if (records.length > GHOST_RUN_ALERT) {
    console.warn("[GHOST] Hid more runs in one night than the rule has ever hidden", {
      date: serviceDate,
      hidden: records.length,
      alertAbove: GHOST_RUN_ALERT,
    });
  }

  // The update reply counts rows changed either way, so the flagged total is
  // read back: one count over the day's window.
  const counted = (await runCommand(() =>
    prisma.$runCommandRaw({ count: events, query: { scheduledAt: window, ghost: true } }),
  )) as unknown as { n?: number };

  return { trips: levels.length, flagged: counted.n ?? 0, hidden: records.length };
}
