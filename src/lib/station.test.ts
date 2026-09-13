// src/lib/station.test.ts
// Unit tests for train-station platform collapsing in station.ts.
import {
  isLegacyStationId,
  isPlatformStop,
  legacyStationId,
  normaliseHeadsign,
  stationId,
  stationName,
} from "@/lib/station";
import { describe, expect, it } from "vitest";

describe("isPlatformStop", () => {
  it("matches numbered train-station platforms on the name alone", () => {
    expect(isPlatformStop("Newmarket Train Station 2")).toBe(true);
    expect(isPlatformStop("Maungawhau Train Station 4")).toBe(true);
    expect(isPlatformStop("Te Waihorotiu Train Station 1")).toBe(true);
  });

  it("treats an unnumbered station as a platform only when AT gives it a platform code", () => {
    // Onehunga is a single-platform station: no number in the name, platform_code "1".
    expect(isPlatformStop("Onehunga Train Station", { platformCode: "1" })).toBe(true);
    expect(isPlatformStop("Onehunga Train Station")).toBe(false);
  });

  it("leaves every other stop alone", () => {
    expect(isPlatformStop("Avondale Station")).toBe(false);
    expect(isPlatformStop("Bay 1 Manukau Bus Station", { platformCode: "1" })).toBe(false);
    expect(isPlatformStop("Titi Street/Otahuhu Train Station")).toBe(false);
    expect(isPlatformStop("Stop A Albany Bus Station", { platformCode: "A" })).toBe(false);
  });
});

describe("stationName", () => {
  it("drops the platform number", () => {
    expect(stationName("Newmarket Train Station 2")).toBe("Newmarket Train Station");
  });

  it("passes other names through unchanged", () => {
    expect(stationName("Onehunga Train Station")).toBe("Onehunga Train Station");
    expect(stationName("Great North Road/Ash Street")).toBe("Great North Road/Ash Street");
  });
});

describe("stationId", () => {
  it("keys a platform off AT's parent_station, so a rename cannot fork it", () => {
    const before = stationId("9312-e5a780ea", "Britomart Train Station 1", {
      parentStation: "105-474861ff",
    });
    const after = stationId("9312-e5a780ea", "Waitemata Train Station 1", {
      parentStation: "105-474861ff",
    });
    expect(before).toBe("station:105-474861ff");
    expect(after).toBe(before);
  });

  it("merges every platform of a station onto one id", () => {
    const p1 = stationId("9312-a", "Papakura Train Station 1", { parentStation: "P-1" });
    const p4 = stationId("9315-d", "Papakura Train Station 4", { parentStation: "P-1" });
    expect(p1).toBe(p4);
  });

  it("collapses a single-platform station via its platform code", () => {
    expect(
      stationId("9503-bcf68071", "Onehunga Train Station", {
        parentStation: "605-b9605c8e",
        platformCode: "1",
      }),
    ).toBe("station:605-b9605c8e");
  });

  it("falls back to the name-derived id when the feed gave no parent", () => {
    expect(stationId("9312-e5a780ea", "Newmarket Train Station 2")).toBe(
      "station:newmarket train station",
    );
  });

  it("leaves non-platform stops on their own id", () => {
    expect(stationId("1534-a48bd69a", "Avondale Station")).toBe("1534-a48bd69a");
    expect(stationId("1741-4e586aef", "Titi Street/Otahuhu Train Station")).toBe("1741-4e586aef");
  });
});

describe("legacy station ids", () => {
  it("recognises the name-derived form so old links can be redirected", () => {
    expect(isLegacyStationId(legacyStationId("Newmarket Train Station 2"))).toBe(true);
    expect(isLegacyStationId("station:105-474861ff")).toBe(false);
    expect(isLegacyStationId("1534-a48bd69a")).toBe(false);
  });
});

describe("normaliseHeadsign", () => {
  it("strips platform numbers following a station name", () => {
    expect(normaliseHeadsign("Swanson 1 To Brit 2 Via Newmarket 2")).toBe(
      "Swanson To Brit Via Newmarket",
    );
    expect(normaliseHeadsign("Waitemata 4")).toBe("Waitemata");
  });

  it("leaves a number that isn't a platform alone", () => {
    // A bare digit-run strip ate any figure the headsign carried, not just
    // platforms - only a number directly after a name is one.
    expect(normaliseHeadsign("To 2 Bridges")).toBe("To 2 Bridges");
  });

  it("passes null through", () => {
    expect(normaliseHeadsign(null)).toBeNull();
  });
});

describe("City Rail Link stations (real feed rows)", () => {
  // Platforms are published as "<name> Train Station <n>" under the station's
  // parent id; the "Stop <letter> <name> Station" rows are bus poles under a
  // separate bus-station parent and must stay on their own ids.
  it("collapses every CRL train platform onto its parent station", () => {
    expect(
      stationId("9297-5284e223", "Te Waihorotiu Train Station 1", {
        parentStation: "131-50330e47",
        platformCode: "1",
      }),
    ).toBe("station:131-50330e47");
    expect(
      stationId("9003-1b6fbb46", "Waitemata Train Station 3", {
        parentStation: "133-08da14b5",
        platformCode: "3",
      }),
    ).toBe("station:133-08da14b5");
  });

  it("keeps the bus poles at a CRL station on their own ids", () => {
    expect(isPlatformStop("Stop C Te Waihorotiu Station", { platformCode: "C" })).toBe(false);
    expect(
      stationId("7086-df733283", "Stop C Te Waihorotiu Station", {
        parentStation: "11014-9f0f7375",
        platformCode: "C",
      }),
    ).toBe("7086-df733283");
    expect(stationId("11011-9f0f7375", "Te Waihorotiu Station")).toBe("11011-9f0f7375");
  });

  it("sends a platform row the feed left without a parent to the name-keyed legacy id", () => {
    // Stale July rows sit beside their parented twins; nothing arrives at them
    // today, but if it did they would split the station.
    expect(stationId("9003-a3bb36e8", "Waitemata Train Station 3")).toBe(
      "station:waitemata train station",
    );
  });
});
