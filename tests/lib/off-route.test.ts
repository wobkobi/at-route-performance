// tests/lib/off-route.test.ts
// Unit tests for measuring vehicles against their trip's road path.
import type { AtTripUpdates } from "@/lib/at";
import {
  confirmedDetour,
  distanceToPathM,
  findOffRoute,
  inProgressTrips,
  MAX_POSITION_AGE_SEC,
  MAX_STOP_UPDATE_AGE_SEC,
  OFF_ROUTE_M,
  shapePrefix,
  type Sighting,
  type VehicleReading,
} from "@/lib/off-route";
import { describe, expect, it } from "vitest";

/** A straight east-west street through the city, `[lon, lat]`. */
const STREET: [number, number][] = [
  [174.76, -36.85],
  [174.77, -36.85],
];

/** Metres of latitude per degree, as the module uses. */
const M = 111_320;

describe("distanceToPathM", () => {
  it("measures across to the segment, not to its ends", () => {
    expect(distanceToPathM(-36.85 + 100 / M, 174.765, STREET)).toBeCloseTo(100, 0);
  });

  it("measures to the nearest end past the segment", () => {
    const d = distanceToPathM(-36.85, 174.77 + 0.001, STREET);
    expect(d).toBeGreaterThan(85);
    expect(d).toBeLessThan(95);
  });

  it("is infinite for an empty path", () => {
    expect(distanceToPathM(-36.85, 174.76, [])).toBe(Infinity);
  });
});

describe("shapePrefix", () => {
  it("takes the block and service segments", () => {
    expect(shapePrefix("258-880001-37980-2-W064560-cca9b45b")).toBe("258-880001");
    expect(shapePrefix("oops")).toBeNull();
  });
});

describe("inProgressTrips", () => {
  it("keeps trips past their first stop with a recent next-stop time", () => {
    const now = 1_789_000_000;
    /**
     * A trip update whose next stop has a sequence and a time.
     * @param id - Trip id.
     * @param seq - The next stop's sequence.
     * @param agoSec - How long ago the next-stop time was.
     * @returns The feed entity.
     */
    const entity = (id: string, seq: number, agoSec: number): AtTripUpdates["entity"][number] => ({
      id,
      trip_update: {
        trip: { trip_id: id, route_id: "r" },
        stop_time_update: [{ stop_id: "s", stop_sequence: seq, arrival: { time: now - agoSec } }],
      },
    });
    const feed: AtTripUpdates = {
      entity: [
        entity("under-way", 5, 60),
        entity("at-origin", 1, 60),
        entity("finished", 30, MAX_STOP_UPDATE_AGE_SEC + 60),
        {
          id: "c",
          trip_update: { trip: { trip_id: "c", route_id: "r", schedule_relationship: 3 } },
        },
      ],
    };
    expect([...inProgressTrips(feed, now)]).toEqual(["under-way"]);
  });
});

describe("findOffRoute", () => {
  const now = 1_789_000_000;
  /**
   * A reading on trip "t" some metres north of the street.
   * @param northM - Metres north of the street.
   * @param extra - Fields to override.
   * @returns The reading.
   */
  const reading = (northM: number, extra: Partial<VehicleReading> = {}): VehicleReading => ({
    tripId: "t",
    routeId: "r",
    vehicleId: "v",
    lat: -36.85 + northM / M,
    lon: 174.765,
    timestamp: now,
    ...extra,
  });
  const inProgress = new Set(["t"]);

  it("keeps only readings beyond the threshold", () => {
    const out = findOffRoute(
      [reading(OFF_ROUTE_M - 20), reading(OFF_ROUTE_M + 50)],
      inProgress,
      () => [STREET],
      now,
    );
    expect(out.map((r) => r.distanceM)).toEqual([OFF_ROUTE_M + 50]);
  });

  it("counts a trip as on route when it is near any candidate path", () => {
    const parallel: [number, number][] = STREET.map(([lon, lat]) => [lon, lat + 400 / M]);
    expect(findOffRoute([reading(400)], inProgress, () => [STREET, parallel], now)).toEqual([]);
  });

  it("skips stale positions, trips not under way, and trips without a path", () => {
    expect(
      findOffRoute(
        [reading(500, { timestamp: now - MAX_POSITION_AGE_SEC - 1 })],
        inProgress,
        () => [STREET],
        now,
      ),
    ).toEqual([]);
    expect(findOffRoute([reading(500)], new Set(), () => [STREET], now)).toEqual([]);
    expect(findOffRoute([reading(500)], inProgress, () => [], now)).toEqual([]);
  });
});

describe("confirmedDetour", () => {
  const T0 = Date.parse("2026-09-14T00:00:00Z");
  /**
   * An ISO instant some minutes after the base.
   * @param min - Minutes after the base.
   * @returns The instant.
   */
  const at = (min: number): string => new Date(T0 + min * 60_000).toISOString();
  /**
   * A sighting at a minute offset.
   * @param min - Minutes after the base.
   * @returns The sighting.
   */
  const seen = (min: number): Sighting => ({ at: at(min), lat: 0, lon: 0, distanceM: 400 });
  const run = [0, 4, 8, 20, 24, 28].map(at);

  it("confirms readings with arrivals on both sides", () => {
    expect(confirmedDetour([seen(12), seen(14)], run).map((s) => s.at)).toEqual([at(12), at(14)]);
  });

  it("needs two confirming readings", () => {
    expect(confirmedDetour([seen(12)], run)).toEqual([]);
  });

  it("ignores a bus driving on after its last arrivals", () => {
    expect(confirmedDetour([seen(27), seen(35), seen(40)], run)).toEqual([]);
  });

  it("ignores a bus that has not reached its first stop", () => {
    expect(confirmedDetour([seen(-10), seen(-5)], run)).toEqual([]);
  });
});
