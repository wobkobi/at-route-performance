// tests/lib/feed/gtfs-stop-ends.test.ts
// Tests the streamed stop_times.txt reader behind each trip's opening and last stops.
import { readStopEnds, StopEndsReader } from "@/lib/feed/gtfs-stop-ends";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

const HEADER = "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint";

/**
 * A stop_times row with the columns the reader ignores filled in.
 * @param trip - Trip id.
 * @param stop - Stop id.
 * @param seq - Stop sequence.
 * @returns The CSV line.
 */
function row(trip: string, stop: string, seq: number): string {
  return `${trip},07:00:00,07:00:00,${stop},${seq},1`;
}

/**
 * Read a whole file through the reader in one push.
 * @param text - The file.
 * @returns The reader's result.
 */
function readAll(text: string): ReturnType<StopEndsReader["end"]> {
  const reader = new StopEndsReader();
  reader.push(text);
  return reader.end();
}

describe("StopEndsReader", () => {
  it("keeps the first three stops and the last", () => {
    const text = [HEADER, ...[1, 2, 3, 4, 5].map((s) => row("t1", `s${s}`, s))].join("\n");
    expect(readAll(text).get("t1")).toEqual({
      startStopIds: ["s1", "s2", "s3"],
      lastStopId: "s5",
    });
  });

  it("orders by stop_sequence, not by row order", () => {
    const text = [
      HEADER,
      row("t1", "c", 30),
      row("t1", "a", 10),
      row("t1", "d", 40),
      row("t1", "b", 20),
    ].join("\n");
    expect(readAll(text).get("t1")).toEqual({ startStopIds: ["a", "b", "c"], lastStopId: "d" });
  });

  it("never counts the final stop as an opening stop", () => {
    const three = [HEADER, row("t1", "a", 1), row("t1", "b", 2), row("t1", "c", 3)].join("\n");
    expect(readAll(three).get("t1")).toEqual({ startStopIds: ["a", "b"], lastStopId: "c" });
    const two = [HEADER, row("t1", "a", 1), row("t1", "b", 2)].join("\n");
    expect(readAll(two).get("t1")).toEqual({ startStopIds: ["a"], lastStopId: "b" });
  });

  it("keeps a loop's first and last stop apart by sequence", () => {
    const text = [HEADER, row("t1", "a", 1), row("t1", "b", 2), row("t1", "a", 3)].join("\n");
    expect(readAll(text).get("t1")).toEqual({ startStopIds: ["a", "b"], lastStopId: "a" });
  });

  it("joins a line split across pushes, and reads CRLF and a missing final newline", () => {
    const text = [HEADER, row("t1", "a", 1), row("t1", "b", 2), row("t2", "x", 1)].join("\r\n");
    const reader = new StopEndsReader();
    for (let i = 0; i < text.length; i += 7) reader.push(text.slice(i, i + 7));
    const ends = reader.end();
    expect(ends.get("t1")).toEqual({ startStopIds: ["a"], lastStopId: "b" });
    expect(ends.get("t2")).toEqual({ startStopIds: [], lastStopId: "x" });
  });

  it("refuses a header without the columns it needs", () => {
    expect(() => readAll("trip_id,stop_id\nt1,a")).toThrow(/missing expected columns/);
  });
});

describe("readStopEnds", () => {
  it("reads stop_times.txt out of a zip and leaves the other files alone", () => {
    const zip = zipSync({
      "trips.txt": strToU8("trip_id,route_id\nt1,70"),
      "stop_times.txt": strToU8([HEADER, row("t1", "a", 1), row("t1", "b", 2)].join("\n")),
    });
    expect(readStopEnds(zip)).toEqual(new Map([["t1", { startStopIds: ["a"], lastStopId: "b" }]]));
  });

  it("throws when the zip has no stop_times.txt", () => {
    expect(() => readStopEnds(zipSync({ "trips.txt": strToU8("trip_id\n") }))).toThrow(/not found/);
  });
});
