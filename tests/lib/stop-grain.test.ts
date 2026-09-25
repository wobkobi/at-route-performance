import { dominantStopMode, stopGrain } from "@/lib/stop-grain";
import { describe, expect, it } from "vitest";

describe("dominantStopMode", () => {
  it("weights by arrivals, not by how many routes there are", () => {
    // Three bus routes calling twice each do not outvote one busy train line.
    expect(
      dominantStopMode([
        { mode: "BUS", events: 2 },
        { mode: "BUS", events: 2 },
        { mode: "BUS", events: 2 },
        { mode: "TRAIN", events: 300 },
      ]),
    ).toBe("TRAIN");
  });

  it("says nothing when nothing arrived", () => {
    expect(dominantStopMode([])).toBeNull();
  });
});

describe("stopGrain", () => {
  it("names one pole by its mode", () => {
    expect(stopGrain("BUS", [], 1)).toBe("Bus stop");
    expect(stopGrain("TRAIN", ["1"], 1)).toBe("Train platform");
    expect(stopGrain("FERRY", [], 1)).toBe("Ferry pier");
  });

  it("counts a grouped place's poles in AT's own word", () => {
    // The measured shapes: Manukau's bays, the Downtown piers, a bus interchange.
    expect(stopGrain("BUS", ["Bay 8", "Bay 17"], 23)).toBe("23 bus bays");
    expect(stopGrain("FERRY", ["Pier 1", "Pier 3"], 14)).toBe("14 ferry piers");
    expect(stopGrain("BUS", ["Stop A", "Stop C"], 2)).toBe("2 bus stops");
  });

  it("falls back to the mode's word when AT numbers the platforms bare", () => {
    expect(stopGrain("TRAIN", ["1", "2"], 5)).toBe("5 train platforms");
  });

  it("drops the mode word rather than guess when nothing arrived", () => {
    expect(stopGrain(null, ["1", "2"], 2)).toBe("2 platforms");
    expect(stopGrain(null, [], 1)).toBe("Stop");
  });

  it("keeps AT's word over the mode's when the two disagree", () => {
    // A bus parent whose poles AT calls bays is not relabelled "stops".
    expect(stopGrain("BUS", ["Bay 1", "Bay 2"], 2)).toBe("2 bus bays");
  });
});
