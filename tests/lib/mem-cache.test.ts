// tests/lib/mem-cache.test.ts
// The in-process TTL store, and sharing one running read between concurrent callers.
import { memCache, sharedInFlight } from "@/lib/mem-cache";
import { describe, expect, it, vi } from "vitest";

describe("memCache", () => {
  it("drops an expired entry when another is written, so dated keys do not pile up", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const store = (globalThis as { __memStore?: Map<string, unknown> }).__memStore;
      await memCache("k-day-1", 60, () => Promise.resolve("first day"));
      expect(store?.has("k-day-1")).toBe(true);
      vi.advanceTimersByTime(61_000);
      await memCache("k-day-2", 60, () => Promise.resolve("second day"));
      expect(store?.has("k-day-1")).toBe(false);
      expect(store?.has("k-day-2")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sharedInFlight", () => {
  it("runs a read once for callers that ask while it is running", async () => {
    const gate = Promise.withResolvers<string>();
    const read = vi.fn(() => gate.promise);
    const first = sharedInFlight("k-share", read);
    const second = sharedInFlight("k-share", read);
    gate.resolve("value");
    expect(await Promise.all([first, second])).toEqual(["value", "value"]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps nothing once the read settles, so the next caller reads again", async () => {
    const read = vi.fn(() => Promise.resolve("value"));
    await sharedInFlight("k-forget", read);
    await sharedInFlight("k-forget", read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("lets a caller after a failed read try again", async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce("value");
    await expect(sharedInFlight("k-fail", read)).rejects.toThrow("down");
    expect(await sharedInFlight("k-fail", read)).toBe("value");
  });
});
