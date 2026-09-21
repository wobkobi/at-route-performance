// tests/app/api/ingest/aggregate/route.test.ts
// Handler tests for POST /api/ingest/aggregate: auth, date validation, the
// explicit-date and catch-up forms, and one IngestRun row per day.
import { POST } from "@/app/api/ingest/aggregate/route";
import { aggregateDay, dayHasEvents, daySummarised } from "@/lib/aggregate";
import { recordIngestRun } from "@/lib/ingest-run";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aggregate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/aggregate")>()),
  aggregateDay: vi.fn(),
  daySummarised: vi.fn(),
  dayHasEvents: vi.fn(),
}));
vi.mock("@/lib/ingest-run", () => ({ recordIngestRun: vi.fn() }));
// `after` needs a request context in Next; run the deferred work inline instead.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  /**
   * Run deferred work at once and keep its promise so a test can await it.
   * @param fn - The deferred work.
   */
  after: (fn: () => Promise<void> | void): void => {
    pending.push(Promise.resolve(fn()));
  },
}));

const pending: Promise<void>[] = [];
const mockedAggregateDay = vi.mocked(aggregateDay);
const mockedSummarised = vi.mocked(daySummarised);
const mockedHasEvents = vi.mocked(dayHasEvents);
const mockedRecord = vi.mocked(recordIngestRun);

/**
 * An authorised POST to the aggregate endpoint.
 * @param qs - Query string, including the leading `?` when present.
 * @returns The request.
 */
function post(qs = ""): Request {
  return new Request(`http://x/api/ingest/aggregate${qs}`, {
    method: "POST",
    headers: { authorization: "Bearer s3cret" },
  });
}

describe("POST /api/ingest/aggregate", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockedAggregateDay.mockResolvedValue({
      aggregated: 3,
      ghosts: { trips: 10, flagged: 2, hidden: 0 },
    });
    mockedSummarised.mockResolvedValue(true);
    mockedHasEvents.mockResolvedValue(true);
  });
  afterEach(async () => {
    await Promise.all(pending.splice(0));
    vi.restoreAllMocks();
    mockedAggregateDay.mockReset();
    mockedRecord.mockReset();
    delete process.env.CRON_SECRET;
  });

  it("refuses an unauthorised call", async () => {
    const res = await POST(new Request("http://x/api/ingest/aggregate", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(mockedAggregateDay).not.toHaveBeenCalled();
  });

  it("refuses an impossible calendar date", async () => {
    const res = await POST(post("?date=2026-02-31"));
    expect(res.status).toBe(400);
    expect(mockedAggregateDay).not.toHaveBeenCalled();
  });

  it("aggregates exactly the requested day and records one run", async () => {
    const res = await POST(post("?date=2026-09-11"));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: true, dates: ["2026-09-11"] });
    await Promise.all(pending.splice(0));
    expect(mockedAggregateDay).toHaveBeenCalledTimes(1);
    expect(mockedAggregateDay.mock.calls[0]?.[1]).toBe("2026-09-11");
    expect(mockedRecord).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "aggregate", success: true, count: 3 }),
    );
  });

  it("catches up the earlier days that have events but no summary, oldest first", async () => {
    mockedSummarised.mockImplementation((date) => Promise.resolve(date !== "2026-09-10"));
    vi.useFakeTimers();
    // 12 Sep 2026 12:00 UTC: the last completed service day is 2026-09-11.
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
    const res = await POST(post());
    vi.useRealTimers();
    expect(await res.json()).toEqual({ started: true, dates: ["2026-09-10", "2026-09-11"] });
    await Promise.all(pending.splice(0));
    expect(mockedAggregateDay.mock.calls.map((c) => c[1])).toEqual(["2026-09-10", "2026-09-11"]);
    expect(mockedRecord).toHaveBeenCalledTimes(2);
  });

  it("records a failed day and still runs the others", async () => {
    mockedSummarised.mockResolvedValue(false);
    mockedAggregateDay
      .mockRejectedValueOnce(new Error("ghost pass: 1 entry failed"))
      .mockResolvedValue({ aggregated: 5, ghosts: { trips: 1, flagged: 0, hidden: 0 } });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
    const res = await POST(post());
    vi.useRealTimers();
    expect(res.status).toBe(202);
    await Promise.all(pending.splice(0));
    expect(mockedAggregateDay).toHaveBeenCalledTimes(3);
    expect(mockedRecord).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "2026-09-09: ghost pass: 1 entry failed" }),
    );
    expect(mockedRecord).toHaveBeenCalledWith(expect.objectContaining({ success: true, count: 5 }));
  });
});
