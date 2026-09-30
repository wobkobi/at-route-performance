import { nearbyFrame } from "@/lib/map/near-frame";
import { describe, expect, it } from "vitest";

const HERE: [number, number] = [-36.85, 174.76];
/** Degrees of latitude in a metre. */
const LAT_PER_M = 1 / 111_320;

/**
 * A point due north of the reader.
 * @param m - Metres north.
 * @returns The point as `[lat, lon]`.
 */
function north(m: number): [number, number] {
  return [HERE[0] + m * LAT_PER_M, HERE[1]];
}

/**
 * The frame's half-height in metres.
 * @param box - The frame.
 * @returns Metres from its centre to its top edge.
 */
function halfHeight(box: ReturnType<typeof nearbyFrame>): number {
  return (box[1][0] - box[0][0]) / 2 / LAT_PER_M;
}

describe("nearbyFrame", () => {
  it("centres the frame on the reader", () => {
    const box = nearbyFrame(HERE, 20, [north(600)]);
    expect((box[0][0] + box[1][0]) / 2).toBeCloseTo(HERE[0], 9);
    expect((box[0][1] + box[1][1]) / 2).toBeCloseTo(HERE[1], 9);
  });

  it("reaches out to the fifth-nearest vehicle", () => {
    const vehicles = [100, 200, 300, 400, 700, 900].map(north);
    expect(halfHeight(nearbyFrame(HERE, 20, vehicles))).toBeCloseTo(700, 0);
  });

  it("keeps a few blocks in view when a vehicle is right beside the reader", () => {
    expect(halfHeight(nearbyFrame(HERE, 10, [north(20)]))).toBeCloseTo(250, 0);
  });

  it("does not reach past 1.5 km for vehicles", () => {
    expect(halfHeight(nearbyFrame(HERE, 20, [north(5_000)]))).toBeCloseTo(250, 0);
  });

  it("never frames tighter than the fix's own accuracy", () => {
    expect(halfHeight(nearbyFrame(HERE, 800, [north(100)]))).toBeCloseTo(800, 0);
  });

  it("frames a rough fix's whole circle, capped at 8 km", () => {
    expect(halfHeight(nearbyFrame(HERE, 3_000, [north(100)]))).toBeCloseTo(3_000, 0);
    expect(halfHeight(nearbyFrame(HERE, 40_000, []))).toBeCloseTo(8_000, 0);
  });
});
