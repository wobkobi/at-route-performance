// src/lib/db.test.ts
// Unit tests for the raw-command helpers: the transient-error retry and the
// bulk write-error check. The Prisma client itself is never touched.
import {
  DUPLICATE_KEY,
  isTransientConnectionError,
  runCommand,
  throwOnWriteErrors,
} from "@/lib/db";
import { describe, expect, it, vi } from "vitest";

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
    ]) {
      expect(isTransientConnectionError(new Error(msg))).toBe(true);
    }
    expect(isTransientConnectionError(new Error("Invalid `prisma.route.findMany()`"))).toBe(false);
    expect(isTransientConnectionError("ECONNRESET")).toBe(false);
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
