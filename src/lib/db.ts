// src/lib/db.ts
// Shared Prisma client plus raw-command helpers: one retry on transient
// connection resets, and a check that turns a bulk write's silent per-entry
// errors into a thrown error. The client is cached on globalThis so hot reloads
// in development reuse one instance rather than exhausting the pool.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Connection-pool bounds appended to the datasource URL.
 *
 * These are MongoDB driver options, not Prisma's `connection_limit` and
 * `pool_timeout`: those two are relational-connector arguments, and on a
 * `provider = "mongodb"` datasource Prisma hands pooling to the driver, which
 * would ignore them.
 *
 * The default pool is 100 sockets **per instance**. Fluid spawns an instance
 * per burst of concurrency, so a prefetch storm across a dozen instances can
 * point four figures of connections at a self-hosted NAS over the public
 * internet, and the pool clears rather than queues (`P2010`). Ten is ample for
 * the handful of concurrent renders an instance actually serves, and bounds the
 * fleet to something the NAS can hold. `waitQueueTimeoutMS` is the backstop:
 * without it a saturated pool waits forever and the render hangs, where a
 * bounded wait fails cleanly and {@link readFallback} makes it alertable.
 */
const POOL_BOUNDS = { maxPoolSize: "10", waitQueueTimeoutMS: "10000" };

/**
 * The datasource URL with the pool bounds applied, leaving any the URL already
 * sets alone so the environment can still overrule this.
 *
 * Appended as text rather than through `new URL`: a replica-set URI names its
 * hosts comma-separated (`mongodb://h1:27017,h2:27017/db`), which the driver
 * accepts and WHATWG parsing rejects outright, so parsing would skip the bound
 * on exactly the deployments most likely to need it. Option names are matched
 * case-insensitively because the driver treats them that way.
 * @param raw - `DATABASE_URL`, absent on a build with no database.
 * @returns The bounded URL, or undefined to let the schema read the env itself.
 */
export function boundedUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const mark = raw.indexOf("?");
  const query = mark === -1 ? "" : raw.slice(mark + 1);
  const missing = Object.entries(POOL_BOUNDS)
    .filter(([key]) => !new RegExp(`(^|&)${key}=`, "i").test(query))
    .map(([key, value]) => `${key}=${value}`);
  if (missing.length === 0) return raw;
  return `${raw}${mark === -1 ? "?" : "&"}${missing.join("&")}`;
}

const datasourceUrl = boundedUrl(process.env.DATABASE_URL);

// Reuse a single client across hot reloads; falls back to the schema's own
// env("DATABASE_URL") when there is no URL to bound, so a build still works.
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
    ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
  });

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
 * Messages of a database that is not answering at all: the host is down, the
 * port is closed, or the driver gave up choosing a server. These read very
 * differently from a reset socket, and none of them match
 * {@link TRANSIENT_MESSAGE}, so before this existed an outage got no retry at
 * all - the one case where a retry is worth most, because the feed behind it is
 * a snapshot that cannot be fetched again.
 */
const UNREACHABLE_MESSAGE =
  /can'?t reach database server|server selection timeout|ECONNREFUSED|connection refused|ENOTFOUND|ETIMEDOUT/i;

/**
 * Whether an error means the database is unreachable rather than the socket
 * having dropped. Only waiting fixes these, so they are retried on a backoff.
 * @param err - The thrown value.
 * @returns True when the server could not be reached or selected.
 */
export function isDatabaseUnreachableError(err: unknown): boolean {
  return err instanceof Error && UNREACHABLE_MESSAGE.test(err.message);
}

/**
 * Waits between write retries. Four attempts spread over about 27 seconds,
 * which covers a mongod restart or a certificate rotation while still finishing
 * inside the two-minute ingest cycle, so a retry never runs into the next poll.
 */
const WRITE_RETRY_WAITS = [1_000, 3_000, 8_000, 15_000];

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

/**
 * Run a raw MongoDB write with retries that cover an unreachable database, not
 * just a dropped socket. For writes only: a page read fails fast instead, so a
 * reader meets the error boundary rather than a minute of nothing. What is
 * being protected is the ingest, where the payload is a snapshot of where the
 * buses are right now - nothing re-fetches it, so a write that gives up
 * immediately is data lost for good.
 * @param fn - Thunk returning the raw command promise. Must be idempotent: it
 *   is re-run whole, which the arrival upsert's keys already guarantee.
 * @returns The command result.
 */
export async function runWriteCommand<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const wait = WRITE_RETRY_WAITS[attempt];
      const worthRetrying = isTransientConnectionError(err) || isDatabaseUnreachableError(err);
      if (wait === undefined || !worthRetrying) throw err;
      await new Promise<void>((r) => setTimeout(r, wait));
    }
  }
}

/**
 * Marker every degraded page read logs, so an alert keys on one stable string
 * rather than on message text that changes with the driver.
 */
export const DB_READ_FAILED = "[DB-READ-FAILED]";

/**
 * Record a degraded database read at error level under {@link DB_READ_FAILED}.
 *
 * Keeping the page is deliberate and stays: a reader gets a site even when the
 * database is unreachable. What did not work was swallowing the failure
 * outright, because the request then finished as a plain 200 and a pool timeout
 * mid-render was invisible to anything watching status codes. What the reader
 * sees is unchanged; the failure now leaves a trace.
 *
 * For database reads only. An AT feed read that fails is an ordinary outage the
 * pages already expect, and logging those here would bury the signal. Use this
 * directly from a `try`/`catch` and {@link readFallback} from a `.catch`.
 * @param read - Names the read in the log line.
 * @param err - The thrown value; an Error contributes its message only.
 */
export function logReadFailure(read: string, err: unknown): void {
  console.error(`${DB_READ_FAILED} ${read}`, err instanceof Error ? err.message : err);
}

/**
 * A `.catch` handler for a page read that degrades instead of failing, logging
 * through {@link logReadFailure} and substituting a value.
 * @param read - Names the read in the log line.
 * @param fallback - What the caller renders instead.
 * @returns A catch handler returning `fallback`.
 */
export function readFallback<T>(read: string, fallback: T): (err: unknown) => T {
  return (err) => {
    logReadFailure(read, err);
    return fallback;
  };
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
