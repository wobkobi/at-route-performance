// tests/lib/data/shame-streaks.test.ts
// The streak walk over a board's earlier days: board runs, crown runs, gaps and early stops.
import { getShameStreaks } from "@/lib/data/shame-streaks";
import { type DateRange, nzServiceDayRange, nzServiceDayString } from "@/lib/time/service-day";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** One hour row, as much of it as the walk reads. */
interface Hour {
  routeId: string;
  avg_abs_delay_sec: number;
}

const { days, routeBoard, tripBoard } = vi.hoisted(() => {
  const days = new Map<string, Hour[]>();
  /**
   * A mocked day board, from the {@link days} table.
   * @param range - The day asked for.
   * @returns That day's hour rows.
   */
  const read = (range: DateRange): Promise<{ hours: Hour[] }> =>
    Promise.resolve({ hours: days.get(dayOf(range)) ?? [] });
  return { days, routeBoard: vi.fn(read), tripBoard: vi.fn(read) };
});

/**
 * The service date a mocked board read was asked for.
 * @param range - The window the walk passed.
 * @returns Its service date.
 */
function dayOf(range: DateRange): string {
  return nzServiceDayString(range.start);
}

vi.mock("@/lib/data/shame-routes", () => ({ getRouteBoardOfDay: routeBoard }));
vi.mock("@/lib/data/shame-trips", () => ({ getTripBoardOfDay: tripBoard }));

const shown = nzServiceDayRange("2026-10-02");
const filter = { mode: null, schools: "exclude" as const };
/**
 * An hour row.
 * @param routeId - The hour's worst route.
 * @param avg_abs_delay_sec - Its average absolute delay.
 * @returns The row.
 */
function hour(routeId: string, avg_abs_delay_sec: number): Hour {
  return { routeId, avg_abs_delay_sec };
}

beforeEach(() => {
  days.clear();
  routeBoard.mockClear();
  tripBoard.mockClear();
});

describe("getShameStreaks", () => {
  it("counts board days and hours, and a crown run only while it is unbroken", async () => {
    days.set("2026-10-01", [hour("A", 600), hour("A", 500), hour("B", 300)]);
    days.set("2026-09-30", [hour("B", 900), hour("A", 200)]);
    const streaks = await getShameStreaks("route", ["A", "B", "C"], shown, filter);
    expect(streaks.get("A")).toEqual({ days: 3, prevHours: 3, prevCrownedDays: 1 });
    // Crowned on 30 Sep, but not on 1 Oct, so the crown run is already broken.
    expect(streaks.get("B")).toEqual({ days: 3, prevHours: 2, prevCrownedDays: 0 });
    expect(streaks.get("C")).toEqual({ days: 1, prevHours: 0, prevCrownedDays: 0 });
  });

  it("reads the trips board for a trip streak", async () => {
    days.set("2026-10-01", [hour("A", 600)]);
    await getShameStreaks("trip", ["A"], shown, filter);
    expect(tripBoard).toHaveBeenCalled();
    expect(routeBoard).not.toHaveBeenCalled();
  });

  it("keeps a board run through a day too quiet to crown, but ends the crown run", async () => {
    days.set("2026-10-01", [hour("A", 30)]);
    days.set("2026-09-30", [hour("A", 900)]);
    const streaks = await getShameStreaks("route", ["A"], shown, filter);
    expect(streaks.get("A")).toEqual({ days: 3, prevHours: 2, prevCrownedDays: 0 });
  });

  it("ends every run at a day with nothing on the board", async () => {
    days.set("2026-09-30", [hour("A", 900)]);
    const streaks = await getShameStreaks("route", ["A"], shown, filter);
    expect(streaks.get("A")).toEqual({ days: 1, prevHours: 0, prevCrownedDays: 0 });
    expect(routeBoard).toHaveBeenCalledTimes(1);
  });

  it("stops reading once every run has broken", async () => {
    days.set("2026-10-01", [hour("A", 600)]);
    days.set("2026-09-30", [hour("B", 600)]);
    days.set("2026-09-29", [hour("A", 600)]);
    await getShameStreaks("route", ["A"], shown, filter);
    expect(routeBoard.mock.calls.map(([range]) => dayOf(range))).toEqual([
      "2026-10-01",
      "2026-09-30",
    ]);
  });
});
