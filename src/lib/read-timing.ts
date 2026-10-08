// Opt-in timing for the page reads, switched on by READ_TIMING=1 (the CI smoke run
// sets it), so a slow page's server log names the reads behind it. A leaf module,
// so the database helpers and the caches can both use it.

/** Whether read timing is on for this process. */
export const READ_TIMING = process.env.READ_TIMING === "1";

/**
 * Reads quicker than this are not logged. A cache hit or an indexed lookup sits well
 * under it, so what is left is the misses and slow scans worth reading about.
 */
const LOG_FROM_MS = 250;

/**
 * Run a read and, with {@link READ_TIMING} on, log how long it took when that was
 * at least {@link LOG_FROM_MS}. A failed read is logged the same way, marked as failed.
 * @param label - What the read is, as the log line names it.
 * @param fn - The read.
 * @returns The read's result.
 */
export async function timedRead<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!READ_TIMING) return fn();
  const startedAt = Date.now();
  let failed = false;
  try {
    return await fn();
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    const ms = Date.now() - startedAt;
    if (ms >= LOG_FROM_MS) {
      console.log(`[READ-TIMING] ${label} ${ms}ms${failed ? " (failed)" : ""}`);
    }
  }
}
