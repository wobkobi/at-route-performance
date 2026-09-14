// src/lib/cancellation.test.ts
// Unit tests for classifying a cancelled trip by its arrivals.
import {
  arrivedBeforeFlag,
  cancellationStage,
  FLAG_GRACE_SEC,
  RAN_AFTER_MIN_ARRIVALS,
} from "@/lib/cancellation";
import { describe, expect, it } from "vitest";

const FLAG = "2026-09-13T20:00:00.000Z";

/**
 * An ISO instant offset from the flag.
 * @param min - Minutes after the flag (negative for before).
 * @returns The instant.
 */
function atFlag(min: number): string {
  return new Date(Date.parse(FLAG) + min * 60_000).toISOString();
}

describe("arrivedBeforeFlag", () => {
  it("counts an arrival within a poll of the flag as before it", () => {
    expect(arrivedBeforeFlag(FLAG, atFlag(FLAG_GRACE_SEC / 60))).toBe(true);
    expect(arrivedBeforeFlag(FLAG, atFlag(FLAG_GRACE_SEC / 60 + 1))).toBe(false);
  });
});

describe("cancellationStage", () => {
  it("reads a trip with no arrivals as cancelled before it ran", () => {
    expect(cancellationStage(FLAG, [])).toBe("before");
  });

  it("ignores a lone predicted first-stop arrival after the flag", () => {
    expect(cancellationStage(FLAG, [atFlag(37)])).toBe("before");
  });

  it("reads arrivals that stop at the flag as cut short, leftover prediction or not", () => {
    const run = [atFlag(-30), atFlag(-20), atFlag(-10)];
    expect(cancellationStage(FLAG, run)).toBe("mid-trip");
    expect(cancellationStage(FLAG, [...run, atFlag(4)])).toBe("mid-trip");
  });

  it("reads a run of arrivals after the flag as reinstated", () => {
    const after = Array.from({ length: RAN_AFTER_MIN_ARRIVALS }, (_, i) => atFlag(150 + i * 3));
    expect(cancellationStage(FLAG, after)).toBe("ran");
    expect(cancellationStage(FLAG, [atFlag(-5), ...after])).toBe("ran");
    expect(cancellationStage(FLAG, after.slice(1))).toBe("before");
  });
});
