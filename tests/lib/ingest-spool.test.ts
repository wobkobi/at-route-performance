// tests/lib/ingest-spool.test.ts
// Unit tests for the outage spool: what gets held, what gets replayed, and the
// two ways a batch leaves the spool without being replayed (too old, unreadable).
// The blob store is mocked; nothing here touches Vercel.
import { drainSpool, spoolEnabled, spoolWrites, type SpooledWrite } from "@/lib/ingest-spool";
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
function stored(writes: SpooledWrite[]): { stream: ReadableStream<Uint8Array> } {
  const body = gzipSync(new TextEncoder().encode(JSON.stringify(writes)));
  return { stream: new Response(Buffer.from(body)).body as ReadableStream<Uint8Array> };
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
    });
    expect(blob.put).not.toHaveBeenCalled();
    expect(blob.list).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
  });
});

describe("spoolWrites", () => {
  it("stores a batch privately and says so", async () => {
    blob.put.mockResolvedValue({});
    await expect(spoolWrites(WRITES)).resolves.toBe(true);
    const [pathname, , options] = blob.put.mock.calls[0] as [string, unknown, { access: string }];
    expect(pathname.startsWith("ingest-spool/")).toBe(true);
    // The data is not secret, but a spool has no reason to be world-readable.
    expect(options.access).toBe("private");
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

    expect(result).toEqual({ replayed: 2, rows: 6, dropped: 0, stoppedEarly: false });
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

    expect(result).toEqual({ replayed: 0, rows: 0, dropped: 1, stoppedEarly: false });
    expect(blob.get).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
    expect(blob.del).toHaveBeenCalledWith("ingest-spool/old.gz");
  });

  it("drops an unreadable batch instead of retrying it forever", async () => {
    blob.list.mockResolvedValue({ blobs: [entry("ingest-spool/bad.gz")] });
    const junk = gzipSync(new TextEncoder().encode("not json"));
    blob.get.mockResolvedValue({
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

  it("gives up quietly when the spool itself cannot be listed", async () => {
    blob.list.mockRejectedValue(new Error("blob store unavailable"));
    const replay = vi.fn<(w: SpooledWrite[]) => Promise<number>>();

    await expect(drainSpool(replay)).resolves.toEqual({
      replayed: 0,
      rows: 0,
      dropped: 0,
      stoppedEarly: false,
    });
    expect(replay).not.toHaveBeenCalled();
  });
});
