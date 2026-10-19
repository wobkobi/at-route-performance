// tests/lib/feed/ingest-spool.test.ts
// Unit tests for the outage spool: what gets held, what gets replayed, the two
// ways a batch leaves the spool without being replayed (too old, unreadable), and
// when the spool is worth listing at all, since each listing is a billed blob
// operation. The blob store is mocked; nothing here touches Vercel.
import type { RecordedRun } from "@/lib/feed/ingest-run";
import {
  beforeDeadline,
  drainSpool,
  LATE,
  newPollHold,
  noteOutage,
  POLL_BUDGET_MS,
  spoolEnabled,
  spoolMayHold,
  spoolWrites,
  within,
  writeOrHold,
  type PollHold,
  type SpooledWrite,
} from "@/lib/feed/ingest-spool";
import { gzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({
  put: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  list: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  get: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  del: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("@vercel/blob", () => blob);

const WRITES: SpooledWrite[] = [
  { kind: "arrivals", docs: [{ tripId: "t1" }, { tripId: "t2" }] },
  { kind: "insert", collection: "TripDelay", docs: [{ tripId: "t1" }] },
];

/**
 * A listing entry as the drain reads it.
 * @param pathname - The blob's pathname.
 * @param ageMs - How long ago it was uploaded.
 * @returns The entry.
 */
function entry(pathname: string, ageMs = 0): { pathname: string; uploadedAt: Date } {
  return { pathname, uploadedAt: new Date(Date.now() - ageMs) };
}

/**
 * A stored batch, gzipped as the spool writes it.
 * @param writes - The batch's writes.
 * @returns A stand-in for the blob `get` result.
 */
function stored(writes: SpooledWrite[]): {
  statusCode: 200;
  stream: ReadableStream<Uint8Array>;
} {
  const body = gzipSync(new TextEncoder().encode(JSON.stringify(writes)));
  return {
    statusCode: 200,
    stream: new Response(Buffer.from(body)).body as ReadableStream<Uint8Array>,
  };
}

beforeEach(() => {
  for (const fn of Object.values(blob)) fn.mockReset();
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
});

afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

describe("authentication", () => {
  it("counts a store id with an OIDC token, not just a read-write token", () => {
    // The SDK accepts either, so a check that knew only about the token would
    // read a working store as no store and lose an outage's data quietly.
    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_STORE_ID = "store_test";
    process.env.VERCEL_OIDC_TOKEN = "oidc-test";
    expect(spoolEnabled()).toBe(true);

    delete process.env.VERCEL_OIDC_TOKEN;
    expect(spoolEnabled()).toBe(false);
    delete process.env.BLOB_STORE_ID;
  });
});

describe("without a store configured", () => {
  beforeEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_STORE_ID;
    delete process.env.VERCEL_OIDC_TOKEN;
  });

  it("is off, and every call is a no-op", async () => {
    expect(spoolEnabled()).toBe(false);
    await expect(spoolWrites(WRITES)).resolves.toBe(false);
    const replay = vi.fn<(w: SpooledWrite[]) => Promise<number>>();
    await expect(drainSpool(replay)).resolves.toEqual({
      replayed: 0,
      rows: 0,
      dropped: 0,
      stoppedEarly: false,
      pending: false,
    });
    expect(blob.put).not.toHaveBeenCalled();
    expect(blob.list).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
  });

  it("never asks for a drain, whatever the run stamps say", () => {
    expect(spoolMayHold(null)).toBe(false);
    expect(
      spoolMayHold({ startedAt: new Date(0), completedAt: new Date(0), spoolPending: true }),
    ).toBe(false);
  });
});

describe("spoolWrites", () => {
  it("stores a batch privately, under a name no other poll can take", async () => {
    blob.put.mockResolvedValue({});
    await expect(spoolWrites(WRITES)).resolves.toBe(true);
    const [pathname, , options] = blob.put.mock.calls[0] as [
      string,
      unknown,
      { access: string; addRandomSuffix: boolean },
    ];
    expect(pathname.startsWith("ingest-spool/")).toBe(true);
    // The data is not secret, but a spool has no reason to be world-readable.
    expect(options.access).toBe("private");
    // A put to a name already taken overwrites it, and polls overlap.
    expect(options.addRandomSuffix).toBe(true);
  });

  it("holds nothing when there is nothing to hold", async () => {
    await expect(spoolWrites([])).resolves.toBe(false);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("reports a failed store rather than throwing", async () => {
    // Throwing here would turn one lost poll into a failed run.
    blob.put.mockRejectedValue(new Error("blob store unavailable"));
    await expect(spoolWrites(WRITES)).resolves.toBe(false);
  });
});

describe("writeOrHold", () => {
  /** What the driver throws when mongod is stopped. */
  const UNREACHABLE = new Error("Server selection timeout: No available servers");
  const [ARRIVALS, TRIPS] = WRITES as [SpooledWrite, SpooledWrite];

  /**
   * A hold already marked down, as a poll has once it stops calling the database.
   * @param writes - What it has held so far.
   * @returns The hold.
   */
  function downHold(writes: SpooledWrite[] = []): PollHold {
    return { ...newPollHold(Date.now()), writes, down: true };
  }

  it("passes a landed write through and holds nothing", async () => {
    const hold = newPollHold(Date.now());
    await expect(writeOrHold(() => Promise.resolve(5), ARRIVALS, hold)).resolves.toBe(5);
    expect(hold).toMatchObject({ writes: [], down: false });
  });

  it("holds a write the database was not up to take, and marks the poll down", async () => {
    const hold = newPollHold(Date.now());
    await expect(writeOrHold(() => Promise.reject(UNREACHABLE), ARRIVALS, hold)).resolves.toBe(0);
    expect(hold).toMatchObject({ writes: [ARRIVALS], down: true });
  });

  it("holds a write still running at the deadline, and marks the poll down", async () => {
    // A slow database never throws: the write just hangs until Vercel kills the
    // poll, so the deadline is the only thing that can get its rows to the spool.
    const hold: PollHold = { writes: [], down: false, deadline: Date.now() + 20 };
    /**
     * A write against a database too slow to answer.
     * @returns A promise that never settles.
     */
    const hangs = (): Promise<number> => new Promise(() => {});
    await expect(writeOrHold(hangs, ARRIVALS, hold)).resolves.toBe(0);
    expect(hold).toMatchObject({ writes: [ARRIVALS], down: true });
  });

  it("never starts a write once the deadline has passed", async () => {
    const hold: PollHold = { writes: [], down: false, deadline: Date.now() - 1 };
    const attempt = vi.fn(() => Promise.resolve(1));
    await expect(writeOrHold(attempt, TRIPS, hold)).resolves.toBe(0);
    expect(attempt).not.toHaveBeenCalled();
    expect(hold).toMatchObject({ writes: [TRIPS], down: true });
  });

  it("holds every later write without trying it once the poll is down", async () => {
    // Each try against a stopped mongod waits out a 30s server selection; a poll
    // that kept trying was killed at the 300s limit before it reached the spool.
    const hold = downHold([ARRIVALS]);
    const attempt = vi.fn(() => Promise.resolve(1));
    await expect(writeOrHold(attempt, TRIPS, hold)).resolves.toBe(0);
    expect(attempt).not.toHaveBeenCalled();
    expect(hold.writes).toEqual([ARRIVALS, TRIPS]);
  });

  it("fails the run on a write that failed on its own merits", async () => {
    const hold = newPollHold(Date.now());
    const bad = new Error("TripDelay insert: 1 entry failed, first (code 121): validation");
    await expect(writeOrHold(() => Promise.reject(bad), TRIPS, hold)).rejects.toBe(bad);
    expect(hold).toMatchObject({ writes: [], down: false });
  });

  it("holds nothing without a store, so the rows are lost loudly", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const hold = downHold();
    await expect(writeOrHold(() => Promise.reject(UNREACHABLE), ARRIVALS, hold)).rejects.toBe(
      UNREACHABLE,
    );
    expect(hold.writes).toEqual([]);
  });
});

describe("within", () => {
  it("returns the result of a call that settles in time", async () => {
    await expect(within(() => Promise.resolve(7), 1_000)).resolves.toBe(7);
  });

  it("returns LATE for a call still running when time runs out", async () => {
    await expect(within(() => new Promise(() => {}), 10)).resolves.toBe(LATE);
  });

  it("passes on a rejection that arrives in time", async () => {
    const err = new Error("refused");
    await expect(within(() => Promise.reject(err), 1_000)).rejects.toBe(err);
  });

  it("swallows a rejection that arrives after time ran out", async () => {
    // Left unhandled, the late rejection would crash the function instance the
    // next poll runs on; vitest fails the test on one, so passing proves it.
    /**
     * A call that fails only after the caller stopped waiting.
     * @returns A promise that rejects after 30ms.
     */
    const late = (): Promise<never> =>
      new Promise((_, reject) => setTimeout(() => reject(new Error("too late")), 30));
    await expect(within(late, 5)).resolves.toBe(LATE);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});

describe("beforeDeadline", () => {
  it("leaves the poll up when the call settles in time", async () => {
    const hold = newPollHold(Date.now());
    await expect(beforeDeadline(() => Promise.resolve("ok"), hold)).resolves.toBe("ok");
    expect(hold.down).toBe(false);
  });

  it("marks the poll down when the call runs out of time", async () => {
    const hold: PollHold = { writes: [], down: false, deadline: Date.now() + 10 };
    await expect(beforeDeadline(() => new Promise(() => {}), hold)).resolves.toBe(LATE);
    expect(hold.down).toBe(true);
  });

  it("gives every poll the same budget from its own start", () => {
    expect(newPollHold(1_000).deadline).toBe(1_000 + POLL_BUDGET_MS);
    // Inside the two-minute cadence, so the lease is free before the next poll.
    expect(POLL_BUDGET_MS).toBeLessThan(120_000);
  });
});

describe("noteOutage", () => {
  it("marks the poll down only for a database that cannot be reached", () => {
    const hold = newPollHold(Date.now());
    noteOutage(hold, new Error("E11000 duplicate key error collection: setting"));
    expect(hold.down).toBe(false);
    noteOutage(hold, new Error("connect ECONNREFUSED 127.0.0.1:27019"));
    expect(hold.down).toBe(true);
  });
});

describe("drainSpool", () => {
  it("replays oldest first and deletes what landed", async () => {
    blob.list.mockResolvedValue({
      blobs: [entry("ingest-spool/b.gz"), entry("ingest-spool/a.gz")],
    });
    // A fresh stream per call: a ReadableStream can only be read once.
    blob.get.mockImplementation(() => Promise.resolve(stored(WRITES)));
    blob.del.mockResolvedValue(undefined);
    const replay = vi.fn<(w: SpooledWrite[]) => Promise<number>>().mockResolvedValue(3);

    const result = await drainSpool(replay);

    expect(result).toEqual({
      replayed: 2,
      rows: 6,
      dropped: 0,
      stoppedEarly: false,
      pending: false,
    });
    // Sorted by pathname, which leads with the timestamp, so a.gz goes first.
    expect(blob.get.mock.calls.map((c) => c[0])).toEqual([
      "ingest-spool/a.gz",
      "ingest-spool/b.gz",
    ]);
    expect(blob.del).toHaveBeenCalledTimes(2);
  });

  it("passes the stored writes through unchanged", async () => {
    blob.list.mockResolvedValue({ blobs: [entry("ingest-spool/a.gz")] });
    // A fresh stream per call: a ReadableStream can only be read once.
    blob.get.mockImplementation(() => Promise.resolve(stored(WRITES)));
    blob.del.mockResolvedValue(undefined);
    const replay = vi.fn<(w: SpooledWrite[]) => Promise<number>>().mockResolvedValue(1);

    await drainSpool(replay);

    expect(replay).toHaveBeenCalledWith(WRITES);
  });

  it("stops at the first refused batch and leaves it in place", async () => {
    // The database being down is why the batch exists; the next one would fail
    // the same way, and a batch deleted after a failed replay is data lost.
    blob.list.mockResolvedValue({
      blobs: [entry("ingest-spool/a.gz"), entry("ingest-spool/b.gz"), entry("ingest-spool/c.gz")],
    });
    // A fresh stream per call: a ReadableStream can only be read once.
    blob.get.mockImplementation(() => Promise.resolve(stored(WRITES)));
    blob.del.mockResolvedValue(undefined);
    const replay = vi
      .fn<(w: SpooledWrite[]) => Promise<number>>()
      .mockResolvedValueOnce(2)
      .mockRejectedValue(new Error("Can't reach database server at `nas.local:27019`"));

    const result = await drainSpool(replay);

    expect(result.replayed).toBe(1);
    expect(result.rows).toBe(2);
    expect(result.stoppedEarly).toBe(true);
    // The two it could not replay are still there, so the next run must ask again
    // rather than wait for a gap in the run stamps to prompt it.
    expect(result.pending).toBe(true);
    expect(replay).toHaveBeenCalledTimes(2);
    // Only the batch that actually landed is gone.
    expect(blob.del).toHaveBeenCalledTimes(1);
    expect(blob.del).toHaveBeenCalledWith("ingest-spool/a.gz");
  });

  it("drops a batch too old to be worth replaying, without reading it", async () => {
    const twoDays = 2 * 24 * 60 * 60 * 1000;
    blob.list.mockResolvedValue({ blobs: [entry("ingest-spool/old.gz", twoDays)] });
    blob.del.mockResolvedValue(undefined);
    const replay = vi.fn<(w: SpooledWrite[]) => Promise<number>>();

    const result = await drainSpool(replay);

    expect(result).toEqual({
      replayed: 0,
      rows: 0,
      dropped: 1,
      stoppedEarly: false,
      pending: false,
    });
    expect(blob.get).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
    expect(blob.del).toHaveBeenCalledWith("ingest-spool/old.gz");
  });

  it("drops an unreadable batch instead of retrying it forever", async () => {
    blob.list.mockResolvedValue({ blobs: [entry("ingest-spool/bad.gz")] });
    const junk = gzipSync(new TextEncoder().encode("not json"));
    blob.get.mockResolvedValue({
      statusCode: 200,
      stream: new Response(Buffer.from(junk)).body as ReadableStream<Uint8Array>,
    });
    blob.del.mockResolvedValue(undefined);
    const replay = vi.fn<(w: SpooledWrite[]) => Promise<number>>();

    const result = await drainSpool(replay);

    expect(result.dropped).toBe(1);
    expect(result.stoppedEarly).toBe(false);
    expect(replay).not.toHaveBeenCalled();
    expect(blob.del).toHaveBeenCalledWith("ingest-spool/bad.gz");
  });

  it("drops a batch the store answered without a body", async () => {
    // Only a 200 carries a stream. Nothing here sends a conditional request, so
    // a 304 should not arrive - but reading one as an empty body would fail to
    // unzip, which is not a parse error, so the drain would stall on that batch
    // every run from then on. Counting it unreadable clears it instead.
    blob.list.mockResolvedValue({ blobs: [entry("ingest-spool/unchanged.gz")] });
    blob.get.mockResolvedValue({ statusCode: 304, stream: null });
    blob.del.mockResolvedValue(undefined);
    const replay = vi.fn<(w: SpooledWrite[]) => Promise<number>>();

    const result = await drainSpool(replay);

    expect(result).toEqual({
      replayed: 0,
      rows: 0,
      dropped: 1,
      stoppedEarly: false,
      pending: false,
    });
    expect(replay).not.toHaveBeenCalled();
    expect(blob.del).toHaveBeenCalledWith("ingest-spool/unchanged.gz");
  });

  it("gives up quietly when the spool itself cannot be listed", async () => {
    blob.list.mockRejectedValue(new Error("blob store unavailable"));
    const replay = vi.fn<(w: SpooledWrite[]) => Promise<number>>();

    await expect(drainSpool(replay)).resolves.toEqual({
      replayed: 0,
      rows: 0,
      dropped: 0,
      stoppedEarly: false,
      // Nothing was read, so nothing is ruled out.
      pending: true,
    });
    expect(replay).not.toHaveBeenCalled();
  });

  it("reports more waiting when the listing came back full", async () => {
    // The listing is capped, so a full page cannot rule out a ninth batch behind
    // it. Saying so is what stops a drain stalling after a long outage.
    blob.list.mockResolvedValue({
      blobs: Array.from({ length: 8 }, (_, i) => entry(`ingest-spool/${i}.gz`)),
    });
    blob.get.mockImplementation(() => Promise.resolve(stored(WRITES)));
    blob.del.mockResolvedValue(undefined);
    const replay = vi.fn<(w: SpooledWrite[]) => Promise<number>>().mockResolvedValue(1);

    const result = await drainSpool(replay);

    expect(result.replayed).toBe(8);
    expect(result.stoppedEarly).toBe(false);
    expect(result.pending).toBe(true);
  });
});

describe("spoolMayHold", () => {
  // Every run that asks costs a blob listing, and the spool is empty except after
  // an outage, so the default answer has to be no.
  const NOW = Date.parse("2026-09-25T10:00:00Z");

  /**
   * A run stamp that landed a given time ago.
   * @param agoMs - How long before NOW the run finished.
   * @param spoolPending - Whether it left batches behind.
   * @returns The stamp.
   */
  function stamp(agoMs: number, spoolPending = false): RecordedRun {
    const at = new Date(NOW - agoMs);
    return { startedAt: at, completedAt: at, spoolPending };
  }

  it("says no on a healthy cadence", () => {
    // A poll runs every two minutes, so the previous stamp is always about that
    // old by the time the next one asks.
    expect(spoolMayHold(stamp(120_000), NOW)).toBe(false);
    expect(spoolMayHold(stamp(179_000), NOW)).toBe(false);
  });

  it("says yes once a poll has gone unrecorded", () => {
    // A poll that could not reach the database could not record itself either, so
    // a stamp older than a cycle and a half is the evidence a batch is held.
    expect(spoolMayHold(stamp(181_000), NOW)).toBe(true);
    expect(spoolMayHold(stamp(3_600_000), NOW)).toBe(true);
  });

  it("says yes while the last run reports batches still waiting", () => {
    // A drain is capped per run, so a fresh stamp does not mean an empty spool.
    expect(spoolMayHold(stamp(10_000, true), NOW)).toBe(true);
  });

  it("says yes when nothing has been recorded at all", () => {
    expect(spoolMayHold(null, NOW)).toBe(true);
  });
});
