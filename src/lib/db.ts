// src/lib/db.ts
/**
 * @description Shared Prisma client plus a raw-command helper that retries
 * transient Atlas connection resets. The client is cached on globalThis so hot
 * reloads in development reuse one instance rather than exhausting the pool.
 * Atlas closes idle TCP connections after ~30 s and Prisma does not retry
 * `$runCommandRaw` the way it retries model operations, so the helper catches a
 * reset, pauses briefly, and retries once on a fresh socket from the pool.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Reuse a single client across hot reloads; reads DATABASE_URL via the schema.
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: ["error", "warn"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Run a raw MongoDB command with one automatic retry on transient connection
 * resets. Atlas closes idle TCP connections after ~30 s, and Prisma does not
 * retry `$runCommandRaw` the way it retries model operations. On the next
 * attempt the driver opens a fresh socket from the pool.
 * @param fn - Thunk returning the raw command promise.
 * @returns The command result.
 */
export async function runCommand<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("forcibly closed") || msg.includes("connection reset")) {
      await new Promise<void>((r) => setTimeout(r, 300));
      return fn();
    }
    throw err;
  }
}
