// src/lib/utils.test.ts
/**
 * @description Unit tests for the shared helpers buildHref, isObj and sleep in utils.ts.
 */
import { buildHref, isObj, sleep } from "@/lib/utils";
import { describe, expect, it } from "vitest";

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
