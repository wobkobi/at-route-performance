// src/lib/data/scan-gate.ts
// A per-process limit on raw ArrivalEvent day scans. A cold day scan holds a pooled
// connection for minutes on the NAS, so an unbounded burst of them (the all-time
// vehicle count reads every day on record) would hold all ten while every other read
// on the server timed out in the driver's wait queue. Scans past the limit wait here
// instead, where no timeout applies.

/** Which queue a waiting scan joins: front for the window a page shows, back for history. */
export type ScanPriority = "front" | "back";

/** Scans run at once: two of the pool's ten connections, leaving the rest for other reads. */
export const SCAN_SLOTS = 2;

interface Waiter {
  /** The scan's key, so a later caller can move it to the front queue. */
  key: string;
  /** Hands the waiter its slot. */
  start: () => void;
}

interface Gate {
  /** Slots in use. */
  active: number;
  /** Waiters for the shown window, served first. */
  front: Waiter[];
  /** Waiters for history, served once no front waiter is left. */
  back: Waiter[];
}

// Anchored to globalThis like the mem-cache stores, so a hot reload keeps one gate.
const g = globalThis as typeof globalThis & { __scanGate?: Gate };
const gate: Gate = (g.__scanGate ??= { active: 0, front: [], back: [] });

/**
 * Take a slot now, or join the queue for the next free one.
 * @param key - The scan's key.
 * @param priority - The queue to join when every slot is busy.
 * @returns Resolves once the caller holds a slot.
 */
function acquire(key: string, priority: ScanPriority): Promise<void> {
  if (gate.active < SCAN_SLOTS) {
    gate.active++;
    return Promise.resolve();
  }
  return new Promise((start) => gate[priority].push({ key, start }));
}

/** Hand the slot straight to the next waiter, front queue first, or free it. */
function release(): void {
  const next = gate.front.shift() ?? gate.back.shift();
  if (next) next.start();
  else gate.active--;
}

/**
 * Move a scan waiting in the back queue to the end of the front queue, for when the
 * window a page shows needs a day that a history read queued first. Does nothing
 * when no scan with the key is waiting there.
 * @param key - The scan's key.
 */
export function promoteScan(key: string): void {
  const at = gate.back.findIndex((w) => w.key === key);
  if (at >= 0) gate.front.push(...gate.back.splice(at, 1));
}

/**
 * Run a raw day scan once a slot is free, releasing the slot however the scan ends.
 * Wrap only the scan itself, not a cached read around it, so a cache hit never waits.
 * @param key - The scan's key, for {@link promoteScan}.
 * @param priority - Front for the window a page shows, back for history.
 * @param scan - The scan.
 * @returns The scan's result.
 */
export async function withScanSlot<T>(
  key: string,
  priority: ScanPriority,
  scan: () => Promise<T>,
): Promise<T> {
  await acquire(key, priority);
  try {
    return await scan();
  } finally {
    release();
  }
}
