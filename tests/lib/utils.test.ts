// tests/lib/utils.test.ts
// Unit tests for the shared helpers buildHref, isObj, sleep, settleWithin and headStart in utils.ts.

import { buildHref, headStart, isObj, settleWithin, sleep } from "@/lib/utils";
import { describe, expect, it, vi } from "vitest";

describe("buildHref", () => {
  it("returns the bare base when no param survives", () => {
    expect(buildHref("/x", {})).toBe("/x");
    expect(buildHref("/x", { a: null, b: undefined, c: "" })).toBe("/x");
  });
  it("drops null/undefined/empty values, keeps the rest", () => {
    expect(buildHref("/x", { a: "1", b: null, c: undefined, d: "" })).toBe("/x?a=1");
  });
  it("emits params in object-key (insertion) order", () => {
    expect(buildHref("/x", { b: "2", a: "1" })).toBe("/x?b=2&a=1");
  });
  it("reproduces a full shame URL", () => {
    expect(
      buildHref("/shame/trip", {
        window: "week",
        period: "2026-06-08",
        day: undefined,
        mode: "BUS",
        school: "1",
      }),
    ).toBe("/shame/trip?window=week&period=2026-06-08&mode=BUS&school=1");
  });
});

describe("isObj", () => {
  it("is true for plain objects and arrays, false otherwise", () => {
    expect(isObj({})).toBe(true);
    expect(isObj([])).toBe(true);
    expect(isObj(null)).toBe(false);
    expect(isObj("x")).toBe(false);
    expect(isObj(3)).toBe(false);
    expect(isObj(undefined)).toBe(false);
  });
});

describe("sleep", () => {
  it("resolves to undefined", async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });
});

describe("settleWithin", () => {
  it("gives the value when the work beats the deadline", async () => {
    expect(await settleWithin(Promise.resolve(7), 1000)).toBe(7);
  });

  it("gives null once the deadline passes, and leaves the work running", async () => {
    vi.useFakeTimers();
    try {
      const work = Promise.withResolvers<number>();
      const waited = settleWithin(work.promise, 1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await waited).toBeNull();
      work.resolve(7);
      expect(await work.promise).toBe(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes a rejection through", async () => {
    await expect(settleWithin(Promise.reject(new Error("down")), 1000)).rejects.toThrow("down");
  });
});

describe("headStart", () => {
  it("lets an already-settled promise through on a zero head start", async () => {
    expect(await headStart(Promise.resolve(7), 0)).toEqual({ settled: true, value: 7 });
  });

  it("counts a null value as settled", async () => {
    expect(await headStart(Promise.resolve(null), 0)).toEqual({ settled: true, value: null });
  });

  it("reports a promise still running at the deadline, and leaves it running", async () => {
    vi.useFakeTimers();
    try {
      const work = Promise.withResolvers<number>();
      const started = headStart(work.promise, 100);
      await vi.advanceTimersByTimeAsync(100);
      expect(await started).toEqual({ settled: false });
      work.resolve(7);
      expect(await work.promise).toBe(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes a rejection inside the head start through", async () => {
    await expect(headStart(Promise.reject(new Error("down")), 100)).rejects.toThrow("down");
  });
});
