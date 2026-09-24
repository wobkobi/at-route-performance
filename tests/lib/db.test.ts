// tests/lib/db.test.ts
// Unit tests for the raw-command helpers: the transient-error retry and the
// bulk write-error check. The Prisma client itself is never touched.
import {
  boundedUrl,
  DB_READ_FAILED,
  DUPLICATE_KEY,
  isDatabaseUnreachableError,
  isTransientConnectionError,
  logReadFailure,
  readFallback,
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

describe("readFallback", () => {
  it("returns the fallback rather than rethrowing, so the page still renders", async () => {
    const value = await Promise.reject(new Error("pool timed out")).catch(
      readFallback("route-stats", null),
    );
    expect(value).toBeNull();
  });

  it("logs at error level under a stable marker", async () => {
    // The whole point: a swallowed rejection left the request logged as a 200,
    // so a pool timeout mid-render could not be alerted on. An alert keys on
    // this marker, so it has to be in the line and it has to be console.error.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await Promise.reject(new Error("pool timed out")).catch(readFallback("route-stats", null));
    expect(spy).toHaveBeenCalledTimes(1);
    const [line, detail] = spy.mock.calls[0] ?? [];
    expect(line).toContain(DB_READ_FAILED);
    expect(line).toContain("route-stats");
    expect(detail).toBe("pool timed out");
    spy.mockRestore();
  });

  it("carries a non-Error rejection through whole, since a driver may throw one", () => {
    // Called directly rather than through a rejected promise: lint forbids
    // rejecting with a non-Error, and the handler is what is under test.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(readFallback("route-stats", null)({ code: "P2010" })).toBeNull();
    expect(spy.mock.calls[0]?.[1]).toEqual({ code: "P2010" });
    spy.mockRestore();
  });

  it("builds a fresh fallback per call, so one caller cannot mutate another's", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const [a, b] = await Promise.all([
      Promise.reject(new Error("down")).catch(readFallback("fleet", new Map<string, string>())),
      Promise.reject(new Error("down")).catch(readFallback("fleet", new Map<string, string>())),
    ]);
    expect(a).not.toBe(b);
    spy.mockRestore();
  });
});

describe("logReadFailure", () => {
  it("emits the same marker a `.catch` site does, so one alert covers both", () => {
    // The try/catch sites (/live, the 404, the sitemap) have no fallback value to
    // substitute, so they log directly. An alert keyed on the marker has to see
    // them too, or a database outage is only half visible.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logReadFailure("live-figures", new Error("server selection timeout"));
    const [line, detail] = spy.mock.calls[0] ?? [];
    expect(line).toBe(`${DB_READ_FAILED} live-figures`);
    expect(detail).toBe("server selection timeout");
    spy.mockRestore();
  });
});

describe("boundedUrl", () => {
  it("bounds a plain URI", () => {
    expect(boundedUrl("mongodb://h:27017/db")).toBe(
      "mongodb://h:27017/db?maxPoolSize=10&waitQueueTimeoutMS=10000",
    );
  });

  it("bounds a replica-set URI, which new URL() cannot even parse", () => {
    // The comma-separated host list is valid to the driver and rejected by
    // WHATWG parsing, so a parse-based version would skip the bound here - on
    // exactly the deployment shape most likely to need it.
    expect(boundedUrl("mongodb://h1:27017,h2:27017/db?replicaSet=rs0")).toBe(
      "mongodb://h1:27017,h2:27017/db?replicaSet=rs0&maxPoolSize=10&waitQueueTimeoutMS=10000",
    );
  });

  it("leaves a bound the environment already set", () => {
    // Option names are case-insensitive to the driver, so a URL setting
    // maxpoolsize must not collect a second, conflicting maxPoolSize.
    const set = "mongodb://h:27017/db?maxpoolsize=50";
    expect(boundedUrl(set)).toBe("mongodb://h:27017/db?maxpoolsize=50&waitQueueTimeoutMS=10000");
  });

  it("passes through when every bound is already set", () => {
    const set = "mongodb://h:27017/db?maxPoolSize=50&waitQueueTimeoutMS=1";
    expect(boundedUrl(set)).toBe(set);
  });

  it("stays undefined with no URL, so a build without a database still works", () => {
    expect(boundedUrl(undefined)).toBeUndefined();
    expect(boundedUrl("")).toBeUndefined();
  });
});
