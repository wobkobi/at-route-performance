// src/lib/feed/gtfs-stop-ends.ts
// Each trip's opening stops and last stop from the GTFS feed's `stop_times.txt`, for judging a
// trip AT's way: off the first stop on time, into the last stop on time. The file is ~100MB
// uncompressed, so it is inflated in chunks and read line by line, never held whole.
import { Unzip, UnzipInflate } from "fflate";

/**
 * Opening stops kept per trip. AT's bus feed mostly carries only the latest stop passed, so a
 * two-minute poll often misses a bus leaving its first stop; the next two stand in for it.
 */
export const START_STOPS = 3;

/** One trip's ends, in stop order. */
export interface StopEnds {
  /** The first {@link START_STOPS} stops before the last (fewer on a shorter trip). */
  startStopIds: string[];
  lastStopId: string;
}

/** A stop and its place in the trip, while the file is still being read. */
interface SeqStop {
  seq: number;
  stopId: string;
}

/** What is held per trip while reading: the lowest few sequences and the highest. */
interface Tally {
  starts: SeqStop[];
  last: SeqStop;
}

/**
 * Line reader over `stop_times.txt` text pushed in arbitrary chunks. The file is sorted by trip
 * and sequence in practice, but nothing here relies on it: each trip keeps its lowest
 * {@link START_STOPS} sequences and its highest, whatever order the rows arrive in.
 */
export class StopEndsReader {
  private partial = "";
  private cols: { trip: number; stop: number; seq: number } | null = null;
  private readonly trips = new Map<string, Tally>();

  /**
   * Feed the next piece of text; a line split across two pieces is held until it completes.
   * @param text - The next chunk.
   */
  push(text: string): void {
    const lines = (this.partial + text).split("\n");
    this.partial = lines.pop() ?? "";
    for (const line of lines) this.line(line);
  }

  /**
   * Finish reading and return every trip's ends.
   * @returns Stop ends keyed by trip id.
   * @throws {Error} When the header lacks `trip_id`, `stop_id` or `stop_sequence`.
   */
  end(): Map<string, StopEnds> {
    if (this.partial) this.line(this.partial);
    this.partial = "";
    if (!this.cols) throw new Error("stop_times.txt is missing expected columns");
    const out = new Map<string, StopEnds>();
    for (const [trip, t] of this.trips) {
      // The final visit is never an opening stop, so a three-stop trip departs
      // from its first two only, and a one-stop row has none to depart from.
      const starts = t.starts.filter((s) => s.seq < t.last.seq).map((s) => s.stopId);
      out.set(trip, { startStopIds: starts, lastStopId: t.last.stopId });
    }
    return out;
  }

  /**
   * Read one line: the header on the first call, a stop visit after.
   * @param raw - The line, possibly ending in `\r`.
   */
  private line(raw: string): void {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line) return;
    const c = line.split(",");
    if (!this.cols) {
      const header = c.map((h) => h.trim());
      const cols = {
        trip: header.indexOf("trip_id"),
        stop: header.indexOf("stop_id"),
        seq: header.indexOf("stop_sequence"),
      };
      if (cols.trip < 0 || cols.stop < 0 || cols.seq < 0) {
        throw new Error("stop_times.txt is missing expected columns");
      }
      this.cols = cols;
      return;
    }
    const trip = c[this.cols.trip]?.trim();
    const stopId = c[this.cols.stop]?.trim();
    const seq = Number(c[this.cols.seq]);
    if (!trip || !stopId || !Number.isFinite(seq)) return;
    const visit = { seq, stopId };
    const t = this.trips.get(trip);
    if (!t) {
      this.trips.set(trip, { starts: [visit], last: visit });
      return;
    }
    if (seq > t.last.seq) t.last = visit;
    // Insertion into a list of at most START_STOPS, kept in sequence order.
    if (t.starts.length < START_STOPS || seq < t.starts[t.starts.length - 1]!.seq) {
      const at = t.starts.findIndex((s) => s.seq > seq);
      t.starts.splice(at < 0 ? t.starts.length : at, 0, visit);
      if (t.starts.length > START_STOPS) t.starts.pop();
    }
  }
}

/**
 * Read every trip's ends out of an already-downloaded GTFS zip, inflating only
 * `stop_times.txt` and only a chunk at a time.
 * @param zip - The whole GTFS zip.
 * @returns Stop ends keyed by trip id.
 * @throws {Error} When the zip has no `stop_times.txt` or it cannot be read.
 */
export function readStopEnds(zip: Uint8Array): Map<string, StopEnds> {
  const reader = new StopEndsReader();
  const decoder = new TextDecoder();
  let found = false;
  // A list rather than a nullable `let`: TypeScript cannot see the callback assign it.
  const failures: Error[] = [];
  /**
   * Read one inflated chunk, holding any failure for after the push.
   * @param err - Inflate error, if any.
   * @param chunk - The inflated bytes.
   * @param final - True on the file's last chunk.
   */
  const onChunk = (err: Error | null, chunk: Uint8Array, final: boolean): void => {
    if (failures.length > 0) return;
    if (err) failures.push(err);
    else {
      try {
        reader.push(decoder.decode(chunk, { stream: !final }));
      } catch (e) {
        failures.push(e instanceof Error ? e : new Error(String(e)));
      }
    }
  };
  const unzip = new Unzip((file) => {
    if (file.name !== "stop_times.txt") return;
    found = true;
    // UnzipInflate is synchronous, so every chunk lands inside `push` below.
    file.ondata = onChunk;
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.push(zip, true);
  if (failures[0]) throw failures[0];
  if (!found) throw new Error("stop_times.txt not found in the GTFS zip");
  return reader.end();
}
