// tests/components/ui/pager.test.ts
// Unit tests for the page list the pager draws.
import { pageWindow } from "@/components/ui/Pager";
import { describe, expect, it } from "vitest";

describe("pageWindow", () => {
  it("lists every page of a short list", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });

  it("shows a single hidden page rather than a gap", () => {
    expect(pageWindow(1, 4)).toEqual([1, 2, 3, 4]);
  });

  it("folds longer runs into gaps around the current page", () => {
    expect(pageWindow(6, 50)).toEqual([1, "…", 5, 6, 7, "…", 50]);
  });
});
