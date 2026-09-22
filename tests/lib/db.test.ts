// tests/lib/db.test.ts
// Unit tests for the raw-command helpers: the transient-error retry and the
// bulk write-error check. The Prisma client itself is never touched.
import {
  DUPLICATE_KEY,
  isDatabaseUnreachableError,
  isTransientConnectionError,
  runCommand,
  runWriteCommand,
  throwOnWriteErrors,
} from "@/lib/db";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});

describe("runCommand", () => {
  it("retries once after a transient connection error", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("read ECONNRESET"))
      .mockResolvedValueOnce("ok");
    await expect(runCommand(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry other errors", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("E11000 duplicate key"));
    await expect(runCommand(fn)).rejects.toThrow("duplicate key");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("recognises every socket-level failure the driver reports", () => {
    for (const msg of [
      "An existing connection was forcibly closed by the remote host",
      "connection reset by peer",
      "read ECONNRESET",
      "write EPIPE",
      "socket hang up",
      'Raw query failed. Code: `unknown`. Message: `Kind: I/O error: timed out, labels: {"RetryableWriteError"}, source: None`',
    ]) {
      expect(isTransientConnectionError(new Error(msg))).toBe(true);
    }
    expect(isTransientConnectionError(new Error("Invalid `prisma.route.findMany()`"))).toBe(false);
    expect(isTransientConnectionError("ECONNRESET")).toBe(false);
  });
});

describe("isDatabaseUnreachableError", () => {
  it("recognises a database that is not answering", () => {
    for (const msg of [
      "Can't reach database server at `nas.local:27019`",
      "Server selection timeout: No available servers",
      "connect ECONNREFUSED 192.168.1.10:27019",
      "getaddrinfo ENOTFOUND nas.local",
      "connect ETIMEDOUT 192.168.1.10:27019",
    ]) {
      expect(isDatabaseUnreachableError(new Error(msg))).toBe(true);
    }
  });

  it("keeps an outage apart from a dropped socket", () => {
    // The two get different retries, so neither predicate may claim the other's
    // errors: a reset socket is fixed by reconnecting, an outage only by waiting.
    expect(isDatabaseUnreachableError(new Error("read ECONNRESET"))).toBe(false);
    expect(isTransientConnectionError(new Error("connect ECONNREFUSED 10.0.0.1:27019"))).toBe(
      false,
    );
    expect(isDatabaseUnreachableError("ECONNREFUSED")).toBe(false);
  });
});

describe("runWriteCommand", () => {
  it("waits out an unreachable database and keeps the write", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Can't reach database server at `nas.local:27019`"))
      .mockRejectedValueOnce(new Error("Server selection timeout: No available servers"))
      .mockResolvedValueOnce("ok");
    const run = runWriteCommand(fn);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(run).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up once the waits run out", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:27019"));
    const settled = expect(runWriteCommand(fn)).rejects.toThrow("ECONNREFUSED");
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;
    // Four waits, so five attempts in all.
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("does not retry a write that failed on its own merits", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("E11000 duplicate key"));
    await expect(runWriteCommand(fn)).rejects.toThrow("duplicate key");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("throwOnWriteErrors", () => {
  it("passes a clean reply and a reply with only ignored codes", () => {
    expect(() => throwOnWriteErrors({ n: 3 })).not.toThrow();
    expect(() =>
      throwOnWriteErrors(
        { n: 2, writeErrors: [{ index: 1, code: DUPLICATE_KEY, errmsg: "dup" }] },
        [DUPLICATE_KEY],
      ),
    ).not.toThrow();
  });

  it("throws on any other error, naming the write and the first failure", () => {
    expect(() =>
      throwOnWriteErrors(
        {
          writeErrors: [
            { index: 0, code: DUPLICATE_KEY, errmsg: "dup" },
            { index: 4, code: 121, errmsg: "Document failed validation" },
          ],
        },
        [DUPLICATE_KEY],
        "TripDelay insert",
      ),
    ).toThrow("TripDelay insert: 1 entry failed, first (code 121): Document failed validation");
  });
});
