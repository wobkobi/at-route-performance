// tests/lib/ingest-spool.test.ts
// Unit tests for the outage spool: what gets held, what gets replayed, the two
// ways a batch leaves the spool without being replayed (too old, unreadable), and
// when the spool is worth listing at all, since each listing is a billed blob
// operation. The blob store is mocked; nothing here touches Vercel.
import {
  drainSpool,
  spoolEnabled,
  spoolMayHold,
  spoolWrites,
  type SpooledWrite,
} from "@/lib/ingest-spool";
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
    expect(spoolMayHold({ completedAt: new Date(0), spoolPending: true })).toBe(false);
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
  function stamp(
    agoMs: number,
    spoolPending = false,
  ): { completedAt: Date; spoolPending: boolean } {
    return { completedAt: new Date(NOW - agoMs), spoolPending };
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
