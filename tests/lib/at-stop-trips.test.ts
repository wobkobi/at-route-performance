// tests/lib/at-stop-trips.test.ts
// Unit tests for the stop-departures lookup: the call it makes, the four states
// it can return, the boardable filter and the cache TTL rule.
import {
  byServiceDeparture,
  getStopDepartures,
  type ScheduledDeparture,
  serviceDayWindow,
  type StopTripAttr,
  stopTripsTtl,
} from "@/lib/at-stop-trips";
import { SERVICE_START_HOUR } from "@/lib/time";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the fetcher is stubbed: `AtHttpError` stays real, because the module under test branches on
// `instanceof` and a stubbed class would make that test itself.
const { getJson } = vi.hoisted(() => ({ getJson: vi.fn() }));
vi.mock("@/lib/at-static", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/at-static")>()),
  getJson,
}));

const { getFeedWindow } = vi.hoisted(() => ({ getFeedWindow: vi.fn() }));
vi.mock("@/lib/at-versions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/at-versions")>()),
  getFeedWindow,
}));

// The lookup's shaping and its states are under test, not the Data Cache wrapper.
vi.mock("@/lib/mem-cache", () => ({
  /**
   * Pass the factory straight through.
   * @param fn - The cached factory.
   * @returns The factory itself.
   */
  unstable_cache: <T>(fn: T): T => fn,
}));

const WINDOW = { start: "2026-09-17", end: "2026-12-31", version: "VDV" };

/**
 * A departure at a GTFS time, the rest filler.
 * @param departureTime - "HH:MM:SS", or null for an untimed trip.
 * @returns The departure.
 */
const dep = (departureTime: string | null): ScheduledDeparture => ({
  tripId: `t-${departureTime}`,
  routeId: "r",
  stopId: "s",
  headsign: null,
  stopHeadsign: null,
  directionId: null,
  departureTime,
});

/**
 * One raw stoptrips row, as AT sends it.
 * @param tripId - The trip id.
 * @param pickupType - 0 when a rider can board, 1 for set-down only.
 * @param departureTime - GTFS departure time.
 * @param stopId - The platform the row belongs to.
 * @returns The row in AT's JSON:API envelope shape.
 */
function row(
  tripId: string,
  pickupType: number,
  departureTime: string,
  stopId = "1801-a",
): { attributes: StopTripAttr } {
  return {
    attributes: {
      trip_id: tripId,
      route_id: "33-203",
      stop_id: stopId,
      trip_headsign: "Manukau To Papakura Via Takanini",
      stop_headsign: "PAPAKURA",
      direction_id: 0,
      pickup_type: pickupType,
      drop_off_type: 0,
      departure_time: departureTime,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getFeedWindow.mockResolvedValue(WINDOW);
});

describe("serviceDayWindow", () => {
  it("covers the whole service day in one call", () => {
    // 30 is AT's maximum, so the window is [04:00, 34:00): a 24-hour range would
    // have ended at 28:00 and dropped a departure that genuinely runs at 28:00.
    expect(serviceDayWindow("2026-09-24")).toEqual({
      date: "2026-09-24",
      startHour: 4,
      hourRange: 30,
    });
  });

  it("never asks for hour 0, which AT rejects with a 400", () => {
    expect(serviceDayWindow("2026-09-24").startHour).toBeGreaterThanOrEqual(1);
    expect(serviceDayWindow("2026-09-24").startHour).toBe(Math.max(1, SERVICE_START_HOUR));
  });
});

describe("getStopDepartures", () => {
  it("calls stoptrips on the full versioned id with all three filters", async () => {
    // The base id answers 404 on this endpoint, which is the reverse of the
    // /trips path it replaced - that one only accepted the base id.
    getJson.mockResolvedValue({ data: [row("a", 0, "05:20:00")] });
    await getStopDepartures("5906-0bdc14c3", "2026-09-24");
    expect(getJson).toHaveBeenCalledWith("/stops/5906-0bdc14c3/stoptrips", {
      "filter[date]": "2026-09-24",
      "filter[start_hour]": "4",
      "filter[hour_range]": "30",
    });
  });

  it("keeps only the departures a rider can board", async () => {
    // Roughly half of AT's rows are set-down only, at an ordinary pole as much
    // as at an interchange, and they would otherwise fill the board with
    // vehicles nobody can get on.
    getJson.mockResolvedValue({
      data: [row("a", 0, "05:20:00"), row("b", 1, "05:30:00"), row("c", 0, "05:40:00")],
    });
    const result = await getStopDepartures("5906-0bdc14c3", "2026-09-24");
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.departures.map((d) => d.tripId)).toEqual(["a", "c"]);
  });

  it("carries the platform each departure leaves from", async () => {
    // One call answers for every platform of a station, so the row has to say
    // which one it belongs to.
    getJson.mockResolvedValue({
      data: [row("a", 0, "05:20:00", "1801-a"), row("b", 0, "05:30:00", "1810-b")],
    });
    const result = await getStopDepartures("51252-1843ab98", "2026-09-24");
    expect(result.status === "ok" && result.departures.map((d) => d.stopId)).toEqual([
      "1801-a",
      "1810-b",
    ]);
  });

  it("reads a 404 as no service rather than as a failure", async () => {
    const { AtHttpError } = await import("@/lib/at-static");
    getJson.mockRejectedValue(new AtHttpError(404, "/stops/x/stoptrips"));
    expect(await getStopDepartures("5906-0bdc14c3", "2026-09-24")).toEqual({
      status: "no-service",
    });
  });

  it("does not read a stop id containing 404 as an empty schedule", async () => {
    // The old test was `err.message.includes("404")` and the message carries the
    // URL, so at the 25 stops whose id contains "404" a 500 or an exhausted
    // retry was already being served as "no departures".
    const { AtHttpError } = await import("@/lib/at-static");
    getJson.mockRejectedValue(new AtHttpError(500, "/stops/1404-e4d1326d/stoptrips"));
    expect(await getStopDepartures("1404-e4d1326d", "2026-09-24")).toEqual({
      status: "unavailable",
    });
  });

  it("reports any other failure as unavailable, and does not cache it", async () => {
    getJson.mockRejectedValue(new Error("fetch failed"));
    expect(await getStopDepartures("5906-0bdc14c3", "2026-09-24")).toEqual({
      status: "unavailable",
    });
  });

  it("answers a retired day from the window, without calling AT", async () => {
    // AT returns the same 404 body for a retired date as for a quiet stop, so
    // calling it would mean telling the reader nothing ran that day.
    const result = await getStopDepartures("5906-0bdc14c3", "2026-09-11");
    expect(result).toEqual({ status: "outside-feed", window: WINDOW });
    expect(getJson).not.toHaveBeenCalled();
  });

  it("still calls AT when the window could not be read", async () => {
    // A failed /versions read must cost the reader a timetable at worst, not
    // make every day look retired.
    getFeedWindow.mockResolvedValue(null);
    getJson.mockResolvedValue({ data: [row("a", 0, "05:20:00")] });
    const result = await getStopDepartures("5906-0bdc14c3", "1999-01-01");
    expect(result.status).toBe("ok");
    expect(getJson).toHaveBeenCalled();
  });

  it("counts a day with nothing boardable as ok, not as a failure", async () => {
    // The page words this the same way as no-service, but the distinction
    // matters here: the call succeeded.
    getJson.mockResolvedValue({ data: [row("b", 1, "05:30:00")] });
    const result = await getStopDepartures("5906-0bdc14c3", "2026-09-24");
    expect(result).toEqual({ status: "ok", departures: [] });
  });
});

describe("byServiceDeparture", () => {
  it("runs 4am to 4am, so a post-midnight run closes the list in either spelling", () => {
    const order = [
      dep(null),
      dep("00:30:00"),
      dep("23:50:00"),
      dep("24:45:00"),
      dep("04:10:00"),
      dep("9:05:00"),
    ]
      .sort(byServiceDeparture)
      .map((d) => d.departureTime);
    expect(order).toEqual(["04:10:00", "9:05:00", "23:50:00", "00:30:00", "24:45:00", null]);
  });
});

describe("stopTripsTtl", () => {
  // 2026-09-12 20:00 UTC is 13 Sep 08:00 NZST: service date 2026-09-13, UTC date 2026-09-12.
  const nzMorning = new Date("2026-09-12T20:00:00Z");

  it("holds today's and future dates for five minutes", () => {
    expect(stopTripsTtl("2026-09-13", nzMorning)).toBe(300);
    expect(stopTripsTtl("2026-09-14", nzMorning)).toBe(300);
  });

  it("holds a past service date for an hour", () => {
    expect(stopTripsTtl("2026-09-12", nzMorning)).toBe(3600);
  });

  it("judges today by the NZ service date, not the UTC calendar date", () => {
    // 13 Sep 03:00 NZST is still service date 2026-09-12 (the day starts at 4am)
    // and UTC date 2026-09-12: the day in progress stays on the short TTL.
    const preDawn = new Date("2026-09-12T15:00:00Z");
    expect(stopTripsTtl("2026-09-12", preDawn)).toBe(300);
    expect(stopTripsTtl("2026-09-13", preDawn)).toBe(300);
    expect(stopTripsTtl("2026-09-11", preDawn)).toBe(3600);
  });
});
