// src/lib/db.ts
// Shared Prisma client plus raw-command helpers: one retry on transient
// connection resets, and a check that turns a bulk write's silent per-entry
// errors into a thrown error. The client is cached on globalThis so hot reloads
// in development reuse one instance rather than exhausting the pool.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Reuse a single client across hot reloads; reads DATABASE_URL via the schema.
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: ["error", "warn"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Messages of the socket-level failures a fresh connection fixes. Hosted MongoDB
 * and intermediate NATs close idle TCP connections; the driver reports that as
 * a reset, a broken pipe or a hung-up socket depending on which side noticed.
 * A socket read that times out on a long-haul link (a CI runner far from the
 * database) surfaces as the driver's "I/O error: timed out", which the server
 * itself labels retryable.
 */
const TRANSIENT_MESSAGE =
  /forcibly closed|connection reset|ECONNRESET|EPIPE|socket hang up|I\/O error: timed out/i;

/**
 * Whether an error is a transient connection failure worth one retry.
 * @param err - The thrown value.
 * @returns True for a socket reset, broken pipe, hang-up or I/O timeout.
 */
export function isTransientConnectionError(err: unknown): boolean {
  return err instanceof Error && TRANSIENT_MESSAGE.test(err.message);
}

/**
 * Run a raw MongoDB command with one automatic retry on transient connection
 * resets. Prisma does not retry `$runCommandRaw` the way it retries model
 * operations; on the next attempt the driver opens a fresh socket from the pool.
 * @param fn - Thunk returning the raw command promise.
 * @returns The command result.
 */
export async function runCommand<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isTransientConnectionError(err)) {
      await new Promise<void>((r) => setTimeout(r, 300));
      return fn();
    }
    throw err;
  }
}

/** MongoDB's duplicate-key error code, the expected outcome of an idempotent insert. */
export const DUPLICATE_KEY = 11000;

/** The per-entry errors a bulk `insert` or `update` reply may carry. */
interface BulkReply {
  writeErrors?: { index: number; code: number; errmsg: string }[];
}

/**
 * Throw when a bulk write reply carries errors other than the codes listed. An
 * `ordered: false` bulk command carries on past a failed entry and the promise
 * still resolves, so a write that half-failed would otherwise pass unnoticed.
 * @param reply - The raw command reply.
 * @param ignoreCodes - Error codes that are expected (a duplicate key on an idempotent insert).
 * @param what - Names the write in the error message.
 */
export function throwOnWriteErrors(
  reply: unknown,
  ignoreCodes: readonly number[] = [],
  what = "bulk write",
): void {
  const errors = ((reply as BulkReply).writeErrors ?? []).filter(
    (e) => !ignoreCodes.includes(e.code),
  );
  const [first] = errors;
  if (first) {
    throw new Error(
      `${what}: ${errors.length} entr${errors.length === 1 ? "y" : "ies"} failed, first (code ${first.code}): ${first.errmsg}`,
    );
  }
}
