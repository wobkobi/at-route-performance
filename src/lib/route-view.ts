// src/lib/route-view.ts
// Builds the map view data for a route - stops, direction-tagged
// path lines, and per-stop delay overlays - from the GTFS schedule pattern. The
// heavy lifting is normalising AT's messy data into one clean line per
// direction: train platforms and suffixed busway poles are collapsed to a single
// canonical station, near-identical variants are merged, interior short-workings
// the full line already covers are dropped, and directions that share terminals
// (or are a prefix/suffix extension of one another) are folded together so the
// diagram shows branches rather than duplicate panels. The static shape depends
// only on the schedule, so it is cached for 24 h; only the day's delay colouring
// is recomputed per request.
import { getRecentStopIds } from "@/lib/data";
import { prisma } from "@/lib/db";
import { memCache } from "@/lib/mem-cache";
import { offsetPath } from "@/lib/route-geo";
import { getRoutePattern } from "@/lib/route-pattern";
import { normaliseHeadsign, stationId, stationName } from "@/lib/station";
import type { RoutePattern, RouteVariant } from "@/types/api";

/**
 * Metres each direction's road line is offset from the shape centreline. Small
 * enough to keep both ways hugging their own carriageway (not the footpath or
 * the next lane over), large enough that opposite directions stay distinct.
 */
const ROAD_OFFSET_M = 6;

/** A stop plotted on the route map. */
export interface MapStop {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  avg_delay_sec: number | null;
  on_time_pct: number | null;
}

/** A route path line tagged with the direction it runs (for per-direction filtering). */
export interface RouteLine {
  directionId: number;
  points: Array<[number, number]>;
}

/** The route map + line-diagram inputs derived from the schedule pattern. */
export interface RouteView {
  stops: MapStop[];
  routeLines: RouteLine[];
  directions: RoutePattern["directions"];
  nameByStop: Map<string, string>;
  /**
   * Maps every original GTFS direction_id that was merged into another to its
   * primary direction id. Empty for routes with no merged directions. Used to
   * resolve `t.direction_id` values that no longer appear as direction keys.
   */
  directionIdAliases: Map<number, number>;
  /**
   * Maps raw GTFS stop IDs to their canonical IDs (busway stops and station
   * variants are collapsed to a single representative ID). Used to translate
   * AT alert `informed_entity.stop_id` values - which reference raw GTFS IDs -
   * to the canonical IDs the SVG diagram renders.
   */
  rawToCanon: Map<string, string>;
  /**
   * Whether the stopping pattern could not be read at all. True means the
   * empty `directions` describes an outage, not a route without a schedule, and
   * the page says so instead of quietly dropping its direction chips and its
   * line diagram.
   */
  patternFailed: boolean;
}

/** Static route shape: pattern + stop positions + road geometry, without day-specific delay data. */
interface RouteShape {
  staticStops: Array<{ stop_id: string; name: string; lat: number; lon: number }>;
  routeLines: RouteLine[];
  directions: RoutePattern["directions"];
  nameByStop: Map<string, string>;
  directionIdAliases: Map<number, number>;
  rawToCanon: Map<string, string>;
}

/**
 * A shape with nothing in it, for a route whose pattern could not be read.
 * Built fresh each time rather than shared, so no caller can mutate a constant
 * every other route would then see.
 * @returns An empty shape.
 */
function emptyShape(): RouteShape {
  return {
    staticStops: [],
    routeLines: [],
    directions: {},
    nameByStop: new Map(),
    directionIdAliases: new Map(),
    rawToCanon: new Map(),
  };
}

/**
 * Whether `a`'s stop sequence appears as a **strictly interior** contiguous run
 * inside `b` - not sharing `b`'s first or last stop. Used to drop variants that
 * enter *and* leave service mid-line, whose stops the full line already shows. A
 * variant that shares an end is a real pattern and is kept: a prefix is a
 * short-working that terminates early (e.g. most 65 trips end at Walker Park and
 * don't continue to Selwyn Village), and a suffix is a different origin - the
 * diagram forks both off rather than hiding them inside the longer variant.
 * @param a - Candidate shorter sequence.
 * @param b - Candidate longer sequence.
 * @returns True when `a` is a strictly-interior contiguous sub-sequence of `b`.
 */
function isInteriorSub(a: string[], b: string[]): boolean {
  if (a.length === 0 || a.length >= b.length) return false;
  const key = a.join(">");
  // Skip i = 0 (prefix) and the final position (suffix); only interior runs.
  for (let i = 1; i + a.length < b.length; i++) {
    if (b.slice(i, i + a.length).join(">") === key) return true;
  }
  return false;
}

/**
 * Compute the static route shape: stopping pattern, stop positions, and road
 * geometry. Everything here depends only on the GTFS schedule (stable within a
 * day), so the result is cached with a 24 h TTL and shared across requests that
 * hit the same route.
 * @param routeId - AT route id.
 * @param mode - Route mode (only trains have platform headsigns to normalise).
 * @returns Static shape data with uncoloured stops.
 */
async function queryRouteShape(routeId: string, mode: string): Promise<RouteShape> {
  const empty = emptyShape();

  // Neither call is caught here. A swallowed failure would be indistinguishable
  // from a route with no schedule, and worse, `buildRouteView` caches this
  // result for 24 hours - so one AT blip would leave the route with no
  // directions and no diagram for the rest of the day. Rejecting instead leaves
  // the cache empty, and the caller says what happened.
  const [pattern, activeStops] = await Promise.all([
    getRoutePattern(routeId),
    getRecentStopIds(routeId),
  ]);

  // Keep every variant with a usable length; the not-recently-served filter is
  // applied later per *station* (not per platform), so a station is kept when any
  // of its platforms ran - otherwise a variant that uses a quiet platform loses a
  // whole station (e.g. Britomart) and stops merging with the main line.
  const directionsRaw: RoutePattern["directions"] = {};
  for (const [dir, d] of Object.entries(pattern.directions)) {
    const variants = d.variants.filter((v) => v.stopIds.length >= 2);
    if (variants.length > 0) directionsRaw[Number(dir)] = { variants };
  }

  const patternStopIds = [
    ...new Set(Object.values(directionsRaw).flatMap((d) => d.variants.flatMap((v) => v.stopIds))),
  ];
  if (patternStopIds.length === 0) return empty;

  const stopDocs = await prisma.stop.findMany({
    where: { id: { in: patternStopIds } },
    select: {
      id: true,
      name: true,
      lat: true,
      lon: true,
      parentStation: true,
      platformCode: true,
    },
  });
  if (stopDocs.length === 0) return empty;

  // Canonical-station remap: collapse each train platform to its station id,
  // keeping one display name + coordinate per station. Interchange poles that
  // share a physical station ("Stop A Albany Bus Station", "Stop B Albany Bus
  // Station") are also collapsed so variants using different poles do not split
  // into separate diagram directions.
  //
  // Poles are matched on name, not on AT's `parent_station`, even though train
  // platforms now key off it. AT's parents are reliable for stations (platforms
  // sit within ~140 m) but group bus and ferry stops up to ~465 m apart, and
  // sometimes span distinct intersections - merging those would pull real
  // geography out of the diagram. The place name is the tighter grouping here.
  const BUSWAY_STOP_RE = /^Stop\s+[A-Z]{1,2}\s+(.*)$/i;
  const buswayBaseToFirstId = new Map<string, string>();
  const idToCanon = new Map<string, string>();
  const canonName = new Map<string, string>();
  const canonCoord = new Map<string, { lat: number; lon: number }>();
  for (const s of stopDocs) {
    let cid = stationId(s.id, s.name, s);
    // Capture group 1 is the station name after the "Stop X" pole prefix.
    const buswayBase = BUSWAY_STOP_RE.exec(s.name)?.[1];
    if (buswayBase !== undefined) {
      const firstId = buswayBaseToFirstId.get(buswayBase);
      if (firstId === undefined) buswayBaseToFirstId.set(buswayBase, cid);
      else cid = firstId;
    }
    idToCanon.set(s.id, cid);
    if (!canonName.has(cid)) {
      canonName.set(cid, buswayBase ?? stationName(s.name, s));
      canonCoord.set(cid, { lat: s.lat, lon: s.lon });
    }
  }

  // A station counts as recently served if ANY of its platforms did. Drop
  // never-served stations (termini the route skips, id mismatches) unless there
  // is no recent data at all.
  const activeStations = new Set<string>();
  for (const s of stopDocs)
    if (activeStops.has(s.id)) activeStations.add(idToCanon.get(s.id) ?? s.id);
  const filterActive = activeStations.size > 0;

  // Remap + dedupe each variant's stop sequence to canonical stations (dropping
  // inactive stations), normalise train headsigns, then merge variants that
  // collapse to the same sequence.
  const directions: RoutePattern["directions"] = {};
  for (const [dir, d] of Object.entries(directionsRaw)) {
    const merged = new Map<string, RouteVariant>();
    for (const v of d.variants) {
      const seq: string[] = [];
      for (const id of v.stopIds) {
        const c = idToCanon.get(id) ?? id;
        if (filterActive && !activeStations.has(c)) continue;
        if (seq[seq.length - 1] !== c) seq.push(c);
      }
      if (seq.length < 2) continue;
      const key = seq.join(">");
      const existing = merged.get(key);
      if (existing) {
        existing.tripCount += v.tripCount;
        if (v.shapeId && !existing.shapeIds?.includes(v.shapeId))
          existing.shapeIds = [...(existing.shapeIds ?? []), v.shapeId];
      } else {
        merged.set(key, {
          headsign: mode === "TRAIN" ? normaliseHeadsign(v.headsign) : v.headsign,
          directionId: v.directionId,
          tripCount: v.tripCount,
          stopIds: seq,
          shapeId: v.shapeId,
          shapeIds: v.shapeId ? [v.shapeId] : [],
        });
      }
    }
    // Drop variants that run only an interior part of a longer one (entering and
    // leaving mid-line) - the full line already shows those stops. Short-workings
    // that share an end (an early terminus or a different origin) are kept; the
    // diagram forks them off. Fold a dropped variant's trips and shapes into its
    // container, so a run on the dropped shape still finds its version.
    const all = [...merged.values()];
    const variants = all.filter((v) => {
      const container = all.find((o) => o !== v && isInteriorSub(v.stopIds, o.stopIds));
      if (container) {
        container.tripCount += v.tripCount;
        container.shapeIds = [...(container.shapeIds ?? []), ...(v.shapeIds ?? [])];
      }
      return !container;
    });
    if (variants.length > 0) directions[Number(dir)] = { variants };
  }

  // Some AT routes assign distinct direction_ids to services that share the same
  // terminal stops but diverge in the middle (e.g. MTIA direct vs Via Devonport).
  // Merge those into one direction key so the diagram shows them as variants of
  // the same line rather than separate direction panels.
  // Remap each merged variant's directionId to the primary key so route-line
  // direction filtering and map display stay consistent.
  const directionIdAliases = new Map<number, number>();
  const byTerminals = new Map<string, number[]>();
  for (const [dirKey, d] of Object.entries(directions)) {
    const dir = Number(dirKey);
    const first = d.variants[0]?.stopIds[0] ?? "";
    const last = d.variants[0]?.stopIds.at(-1) ?? "";
    const tKey = `${first}::${last}`;
    const group = byTerminals.get(tKey);
    if (group) group.push(dir);
    else byTerminals.set(tKey, [dir]);
  }
  for (const group of byTerminals.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a - b);
    // Lowest direction id in the group is the primary; the rest fold into it.
    const [primary, ...rest] = group;
    if (primary === undefined) continue;
    const target = directions[primary];
    if (!target) continue;
    for (const dir of rest) {
      const source = directions[dir];
      if (!source) continue;
      directionIdAliases.set(dir, primary);
      target.variants.push(...source.variants.map((v) => ({ ...v, directionId: primary })));
      delete directions[dir];
    }
    target.variants.sort((a, b) => b.tripCount - a.tripCount);
  }

  // Merge directions where one is a prefix extension of another: when direction A's
  // longest variant ends at a stop that appears mid-way in direction B (same first
  // stop), fold A's variants into B so the extension shows as a branch rather than
  // a separate diagram panel. Example: NX1 "Britomart > Albany" folds into
  // "Britomart > Albany > Hibiscus Coast", keeping both as one direction.
  {
    const extKeys = Object.keys(directions).map(Number);
    outer: for (const dA of [...extKeys]) {
      if (!directions[dA]) continue;
      const aSeq = directions[dA].variants.reduce<string[]>(
        (acc, v) => (v.stopIds.length > acc.length ? v.stopIds : acc),
        [],
      );
      const aFirst = aSeq[0];
      const aLast = aSeq.at(-1);
      if (aSeq.length < 2 || aFirst === undefined || aLast === undefined) continue;
      for (const dB of extKeys) {
        if (dA === dB || !directions[dB]) continue;
        const bSeq = directions[dB].variants.reduce<string[]>(
          (acc, v) => (v.stopIds.length > acc.length ? v.stopIds : acc),
          [],
        );
        if (bSeq[0] !== aFirst) continue;
        const aLastInB = bSeq.indexOf(aLast);
        // A's last stop must appear inside B, not at B's end (same-terminal cases
        // were already handled by the terminal merge above).
        if (aLastInB < 1 || aLastInB >= bSeq.length - 1) continue;
        // Verify every stop in A appears at the matching position in B (a strict prefix).
        if (!aSeq.every((s, i) => bSeq[i] === s)) continue;
        directionIdAliases.set(dA, dB);
        directions[dB].variants.push(
          ...directions[dA].variants.map((v) => ({ ...v, directionId: dB })),
        );
        directions[dB].variants.sort((a, b) => b.tripCount - a.tripCount);
        delete directions[dA];
        continue outer;
      }
    }
  }

  // Merge directions where one is a suffix extension of another: when direction A's
  // longest variant starts at a stop that appears mid-way in direction B (same last
  // stop), fold A's variants into B. This handles short-working services that begin
  // mid-route rather than at the terminus - e.g. EAST "Panmure > Britomart" folds
  // into "Manukau > Panmure > Britomart", keeping both as one direction.
  {
    const extKeys = Object.keys(directions).map(Number);
    outer: for (const dA of [...extKeys]) {
      if (!directions[dA]) continue;
      const aSeq = directions[dA].variants.reduce<string[]>(
        (acc, v) => (v.stopIds.length > acc.length ? v.stopIds : acc),
        [],
      );
      const aFirst = aSeq[0];
      const aLast = aSeq.at(-1);
      if (aSeq.length < 2 || aFirst === undefined || aLast === undefined) continue;
      for (const dB of extKeys) {
        if (dA === dB || !directions[dB]) continue;
        const bSeq = directions[dB].variants.reduce<string[]>(
          (acc, v) => (v.stopIds.length > acc.length ? v.stopIds : acc),
          [],
        );
        if (bSeq.at(-1) !== aLast) continue;
        const aFirstInB = bSeq.indexOf(aFirst);
        // A's first stop must appear inside B, not at B's start (same-terminal cases
        // were already handled by the terminal merge above).
        if (aFirstInB < 1 || aFirstInB >= bSeq.length - 1) continue;
        // Verify every stop in A appears at the matching position in B (a strict suffix).
        if (!aSeq.every((s, i) => bSeq[aFirstInB + i] === s)) continue;
        directionIdAliases.set(dA, dB);
        directions[dB].variants.push(
          ...directions[dA].variants.map((v) => ({ ...v, directionId: dB })),
        );
        directions[dB].variants.sort((a, b) => b.tripCount - a.tripCount);
        delete directions[dA];
        continue outer;
      }
    }
  }

  const mergedVariants = Object.values(directions).flatMap((d) => d.variants);
  const usedStations = [...new Set(mergedVariants.flatMap((v) => v.stopIds))];

  const staticStops = usedStations
    .filter((cid) => canonCoord.has(cid))
    .map((cid) => {
      const coord = canonCoord.get(cid) as { lat: number; lon: number };
      return { stop_id: cid, name: canonName.get(cid) ?? cid, lat: coord.lat, lon: coord.lon };
    });

  const nameByStop = new Map(usedStations.map((cid) => [cid, canonName.get(cid) ?? cid]));

  // Road geometry: load the merged variants' GTFS shapes; draw each direction's
  // real road path offset to its own side. Fall back to a straight station-to-
  // station line when a shape is missing.
  const shapeIds = [
    ...new Set(mergedVariants.map((v) => v.shapeId).filter((s): s is string => !!s)),
  ];
  const shapeDocs = shapeIds.length
    ? await prisma.shape.findMany({
        where: { id: { in: shapeIds } },
        select: { id: true, points: true },
      })
    : [];
  if (shapeIds.length > 0 && shapeDocs.length === 0) {
    console.warn(
      `[route-view] No Shape records found for ${shapeIds.length} shape IDs — run /api/ingest/gtfs/shapes`,
    );
  }
  const shapeById = new Map(
    shapeDocs.map((s) => [s.id, s.points as unknown as [number, number][]]),
  );

  const routeLines: RouteLine[] = mergedVariants
    .map((v) => {
      const shape = v.shapeId ? shapeById.get(v.shapeId) : undefined;
      const points =
        shape && shape.length > 1
          ? // Shapes store [lon, lat]; the map wants [lat, lon]. Offset by direction.
            offsetPath(
              shape.map(([lon, lat]) => [lat, lon] as [number, number]),
              ROAD_OFFSET_M,
              v.directionId === 1 ? -1 : 1,
            )
          : v.stopIds
              .map((id) => canonCoord.get(id))
              .filter((s): s is NonNullable<typeof s> => Boolean(s))
              .map((s) => [s.lat, s.lon] as [number, number]);
      return { directionId: v.directionId, points };
    })
    .filter((line) => line.points.length > 1);

  return {
    staticStops,
    routeLines,
    directions,
    nameByStop,
    directionIdAliases,
    rawToCanon: idToCanon,
  };
}

/**
 * Build the route map (stops + per-variant path lines) and the line-diagram
 * inputs from the schedule pattern, colouring stops by the supplied per-stop
 * stats. The static shape (pattern, stop positions, road geometry) is cached
 * with a 24 h TTL via {@link queryRouteShape} so AT API calls and Prisma queries
 * only fire once per route per day. Only the per-day delay colouring is applied
 * fresh on each request.
 *
 * Train platforms are collapsed to one station (see {@link stationId}), which
 * merges the otherwise-duplicate per-platform variants into a single line.
 * Falls back to the supplied stops (no path, no diagram) when the pattern is
 * unavailable.
 * @param routeId - AT route id.
 * @param byStop - Per-stop stats to colour by (already station-collapsed).
 * @param mode - Route mode (only trains have platform headsigns to normalise).
 * @returns Map stops, path lines, pattern directions, and stop names.
 */
export async function buildRouteView(
  routeId: string,
  byStop: MapStop[],
  mode: string,
): Promise<RouteView> {
  // queryRouteShape returns Map values (nameByStop, directionIdAliases, rawToCanon)
  // which next/cache would lose when serialising to JSON. Use memCache instead so
  // the Maps are stored in-process without serialisation. The 24 h TTL means each
  // worker thread pays the AT API cost at most once per day.
  let shape: RouteShape;
  let patternFailed = false;
  try {
    shape = await memCache(`route-shape|${routeId}|${mode}`, 86400, () =>
      queryRouteShape(routeId, mode),
    );
  } catch (err) {
    // memCache stores nothing for a rejected factory, so the next request
    // retries rather than living with this for the 24 h TTL.
    console.warn(
      `[route-view] Pattern unavailable for ${routeId}`,
      err instanceof Error ? err.message : err,
    );
    shape = emptyShape();
    patternFailed = true;
  }

  const delayById = new Map(byStop.map((s) => [s.stop_id, s]));
  // When the route has no pattern data, fall back to the caller's byStop list
  // so the map still shows the stops that had events today.
  const stops: MapStop[] =
    shape.staticStops.length > 0
      ? shape.staticStops.map((s) => ({
          ...s,
          avg_delay_sec: delayById.get(s.stop_id)?.avg_delay_sec ?? null,
          on_time_pct: delayById.get(s.stop_id)?.on_time_pct ?? null,
        }))
      : byStop;

  return {
    stops,
    routeLines: shape.routeLines,
    directions: shape.directions,
    nameByStop: shape.nameByStop,
    directionIdAliases: shape.directionIdAliases,
    rawToCanon: shape.rawToCanon,
    patternFailed,
  };
}
