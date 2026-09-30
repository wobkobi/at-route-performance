// tests/lib/geo/distance.test.ts
// The flat-approximation distances against known Auckland spans.
import { M_PER_DEG, metresBetween, perpMetres } from "@/lib/geo/distance";
import { describe, expect, it } from "vitest";

describe("metresBetween", () => {
  it("measures a degree of latitude as M_PER_DEG", () => {
    expect(metresBetween([-36.8, 174.7], [-35.8, 174.7])).toBeCloseTo(M_PER_DEG, 0);
  });

  it("shrinks a degree of longitude by the cosine of the latitude", () => {
    const d = metresBetween([-36.8, 174.7], [-36.8, 174.71]);
    expect(d).toBeCloseTo(0.01 * M_PER_DEG * Math.cos((36.8 * Math.PI) / 180), 3);
  });
});

describe("perpMetres", () => {
  it("measures off a north-south line by the east offset", () => {
    const off = perpMetres([-36.85, 174.701], [-36.8, 174.7], [-36.9, 174.7]);
    expect(off).toBeCloseTo(0.001 * M_PER_DEG * Math.cos((36.8 * Math.PI) / 180), 3);
  });

  it("falls back to the distance from the end when the line has no length", () => {
    expect(perpMetres([-36.81, 174.7], [-36.8, 174.7], [-36.8, 174.7])).toBeCloseTo(
      0.01 * M_PER_DEG,
      3,
    );
  });
});
