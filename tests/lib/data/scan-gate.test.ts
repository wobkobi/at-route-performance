// tests/lib/data/scan-gate.test.ts
// The raw day-scan gate: a cap on scans at once, the shown window ahead of history,
// a queued history scan promoted when the window needs it, and a slot freed however
// a scan ends.
import { promoteScan, SCAN_SLOTS, withScanSlot } from "@/lib/data/scan-gate";
import { describe, expect, it } from "vitest";

/**
 * A scan that ends only when told to.
 * @returns The scan and its resolver.
 */
function heldScan(): { scan: () => Promise<string>; finish: (v: string) => void } {
  const gate = Promise.withResolvers<string>();
  return {
    /**
     * The scan, pending until `finish` is called.
     * @returns The held result.
     */
    scan: () => gate.promise,
    finish: gate.resolve,
  };
}

/** Let every queued microtask run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("withScanSlot", () => {
  it("runs at most the slot count at once, and starts the next as one ends", async () => {
    const held = Array.from({ length: SCAN_SLOTS + 1 }, heldScan);
    let started = 0;
    const runs = held.map((h, i) =>
      withScanSlot(`cap-${i}`, "back", () => {
        started++;
        return h.scan();
      }),
    );
    await settle();
    expect(started).toBe(SCAN_SLOTS);
    held[0]?.finish("a");
    await settle();
    expect(started).toBe(SCAN_SLOTS + 1);
    held.forEach((h) => h.finish("done"));
    await Promise.all(runs);
  });

  it("serves a front waiter before a back waiter that queued earlier", async () => {
    const busy = Array.from({ length: SCAN_SLOTS }, heldScan);
    const running = busy.map((h, i) => withScanSlot(`busy-${i}`, "front", h.scan));
    const order: string[] = [];
    const back = withScanSlot("b", "back", () => Promise.resolve(order.push("back")));
    const front = withScanSlot("f", "front", () => Promise.resolve(order.push("front")));
    await settle();
    busy[0]?.finish("a");
    await Promise.all([back, front]);
    expect(order).toEqual(["front", "back"]);
    busy.forEach((h) => h.finish("done"));
    await Promise.all(running);
  });

  it("moves a queued back scan ahead of the other back waiters once promoted", async () => {
    const busy = Array.from({ length: SCAN_SLOTS }, heldScan);
    const running = busy.map((h, i) => withScanSlot(`busy-${i}`, "front", h.scan));
    const order: string[] = [];
    const first = withScanSlot("old", "back", () => Promise.resolve(order.push("old")));
    const second = withScanSlot("shown", "back", () => Promise.resolve(order.push("shown")));
    await settle();
    promoteScan("shown");
    promoteScan("absent");
    busy[0]?.finish("a");
    await Promise.all([first, second]);
    expect(order).toEqual(["shown", "old"]);
    busy.forEach((h) => h.finish("done"));
    await Promise.all(running);
  });

  it("frees the slot when a scan throws", async () => {
    const failures = Array.from({ length: SCAN_SLOTS }, (_, i) =>
      withScanSlot(`fail-${i}`, "front", () => Promise.reject(new Error("pool closed"))),
    );
    await Promise.allSettled(failures);
    expect(await withScanSlot("after", "back", () => Promise.resolve("ran"))).toBe("ran");
  });
});
