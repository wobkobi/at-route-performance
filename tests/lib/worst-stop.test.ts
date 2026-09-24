// tests/lib/worst-stop.test.ts
// Unit tests for the worst-stop rule: platforms merge into a station, then the
// whole-day floor applies to the merged total.
import { STATION_PREFIX } from "@/lib/station";
import {
  MIN_STOP_EVENTS,
  type RankedStopRow,
  mergeStationPlatforms,
  worstStopOfDay,
} from "@/lib/worst-stop";
import { describe, expect, it } from "vitest";

/** The fields every row here sets, with the rest of the row optional. */
type RowInput = Pick<RankedStopRow, "stop_id" | "name" | "events" | "avg_abs_delay_sec"> &
  Partial<RankedStopRow>;

/**
 * One ranking row, defaulting the signed mean to the magnitude - so an
 * unqualified row is a late stop - and the route ids to a single train line.
 * @param over - The row's fields.
 * @returns A row in the shape the aggregation projects.
 */
function row(over: RowInput): RankedStopRow {
  return { avg_delay_sec: over.avg_abs_delay_sec, routeIds: ["WEST"], ...over };
}

describe("mergeStationPlatforms", () => {
  it("merges a station's platforms and re-averages by event weight", () => {
    const merged = mergeStationPlatforms([
      row({
        stop_id: "133-a",
        name: "Newmarket Train Station 1",
        events: 30,
        avg_abs_delay_sec: 60,
        parent_station: "133",
        platform_code: "1",
      }),
      row({
        stop_id: "133-b",
        name: "Newmarket Train Station 2",
        events: 10,
        avg_abs_delay_sec: 200,
        parent_station: "133",
        platform_code: "2",
      }),
    ]);

    expect(merged).toHaveLength(1);
    // (30*60 + 10*200) / 40 = 95, not the 130 an unweighted mean of the two gives.
    expect(merged[0]).toMatchObject({
      stop_id: `${STATION_PREFIX}133`,
      name: "Newmarket Train Station",
      events: 40,
      avg_abs_delay_sec: 95,
      avg_delay_sec: 95,
    });
  });

  it("nets a station's signed mean across platforms while its magnitude stays high", () => {
    const [station] = mergeStationPlatforms([
      row({
        stop_id: "133-a",
        name: "Newmarket Train Station 1",
        events: 10,
        avg_delay_sec: -300,
        avg_abs_delay_sec: 300,
        parent_station: "133",
        platform_code: "1",
      }),
      row({
        stop_id: "133-b",
        name: "Newmarket Train Station 2",
        events: 10,
        avg_delay_sec: 300,
        avg_abs_delay_sec: 300,
        parent_station: "133",
        platform_code: "2",
      }),
    ]);

    expect(station!.avg_delay_sec).toBe(0);
    expect(station!.avg_abs_delay_sec).toBe(300);
  });

  it("unions the route ids of every platform, so the row can resolve its mode", () => {
    const [station] = mergeStationPlatforms([
      row({
        stop_id: "133-a",
        name: "Newmarket Train Station 1",
        events: 5,
        avg_abs_delay_sec: 10,
        routeIds: ["WEST", "STH"],
        parent_station: "133",
        platform_code: "1",
      }),
      row({
        stop_id: "133-b",
        name: "Newmarket Train Station 2",
        events: 5,
        avg_abs_delay_sec: 10,
        routeIds: ["STH", "ONE"],
        parent_station: "133",
        platform_code: "2",
      }),
    ]);

    expect([...station!.routeIds].sort()).toEqual(["ONE", "STH", "WEST"]);
  });

  it("never merges two stops that are not platforms, however alike their names", () => {
    const merged = mergeStationPlatforms([
      row({ stop_id: "1401", name: "Queen Street", events: 40, avg_abs_delay_sec: 120 }),
      row({ stop_id: "1402", name: "Queen Street", events: 40, avg_abs_delay_sec: 30 }),
    ]);

    expect(merged.map((m) => m.stop_id)).toEqual(["1401", "1402"]);
  });

  it("merges by name when AT supplied no parent station, as older rows did", () => {
    const merged = mergeStationPlatforms([
      row({
        stop_id: "133-a",
        name: "Newmarket Train Station 1",
        events: 20,
        avg_abs_delay_sec: 5,
      }),
      row({
        stop_id: "133-b",
        name: "Newmarket Train Station 2",
        events: 20,
        avg_abs_delay_sec: 5,
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.stop_id).toBe(`${STATION_PREFIX}newmarket train station`);
  });

  it("sorts worst-first on off-schedule magnitude, not on the signed mean", () => {
    const merged = mergeStationPlatforms([
      row({ stop_id: "a", name: "Mild", events: 40, avg_abs_delay_sec: 30 }),
      row({ stop_id: "b", name: "Early", events: 40, avg_delay_sec: -400, avg_abs_delay_sec: 400 }),
      row({ stop_id: "c", name: "Late", events: 40, avg_abs_delay_sec: 100 }),
    ]);

    expect(merged.map((m) => m.stop_id)).toEqual(["b", "c", "a"]);
  });
});

describe("worstStopOfDay", () => {
  it("names a station that clears the floor only once its platforms are added up", () => {
    const half = Math.ceil(MIN_STOP_EVENTS / 2);
    const worst = worstStopOfDay([
      row({
        stop_id: "133-a",
        name: "Newmarket Train Station 1",
        events: half,
        avg_abs_delay_sec: 400,
        parent_station: "133",
        platform_code: "1",
      }),
      row({
        stop_id: "133-b",
        name: "Newmarket Train Station 2",
        events: half,
        avg_abs_delay_sec: 400,
        parent_station: "133",
        platform_code: "2",
      }),
      row({ stop_id: "1401", name: "Queen Street", events: 500, avg_abs_delay_sec: 100 }),
    ]);

    expect(worst?.stop_id).toBe(`${STATION_PREFIX}133`);
    expect(worst?.events).toBe(half * 2);
  });

  it("skips a station whose merged total is still short of the floor", () => {
    const worst = worstStopOfDay([
      row({
        stop_id: "133-a",
        name: "Newmarket Train Station 1",
        events: 2,
        avg_abs_delay_sec: 900,
        parent_station: "133",
        platform_code: "1",
      }),
      row({
        stop_id: "133-b",
        name: "Newmarket Train Station 2",
        events: 3,
        avg_abs_delay_sec: 900,
        parent_station: "133",
        platform_code: "2",
      }),
      row({
        stop_id: "1401",
        name: "Queen Street",
        events: MIN_STOP_EVENTS,
        avg_abs_delay_sec: 60,
      }),
    ]);

    expect(worst?.stop_id).toBe("1401");
  });

  it("names nothing when no station reaches the floor", () => {
    expect(
      worstStopOfDay([
        row({
          stop_id: "1401",
          name: "Queen Street",
          events: MIN_STOP_EVENTS - 1,
          avg_abs_delay_sec: 900,
        }),
      ]),
    ).toBeNull();
  });

  it("takes the floor as given, so the hour board can pass its own smaller one", () => {
    const rows = [row({ stop_id: "1401", name: "Queen Street", events: 5, avg_abs_delay_sec: 90 })];
    expect(worstStopOfDay(rows, 5)?.stop_id).toBe("1401");
    expect(worstStopOfDay(rows)).toBeNull();
  });
});
