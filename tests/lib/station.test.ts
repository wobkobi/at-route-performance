// tests/lib/station.test.ts
/// Unit tests for collapsing a place's platforms, bays and piers in station.ts.
import {
  isLegacyStationId,
  isPlatformStop,
  legacyStationId,
  normaliseHeadsign,
  platformLabelOf,
  stationId,
  stationName,
  stationNameOf,
} from "@/lib/station";
import { describe, expect, it } from "vitest";

describe("platformLabelOf", () => {
  it("keeps the word AT put beside the code, in AT's own casing", () => {
    expect(platformLabelOf("Bay 23 Manukau Bus Station", { platformCode: "23" })).toBe("Bay 23");
    expect(platformLabelOf("Stop A Hibiscus Coast", { platformCode: "A" })).toBe("Stop A");
    expect(platformLabelOf("Downtown Ferry Terminal Pier 1", { platformCode: "1" })).toBe("Pier 1");
  });

  it("labels a bare code with the code alone, inventing no word", () => {
    expect(platformLabelOf("Newmarket Train Station 1", { platformCode: "1" })).toBe("1");
    expect(platformLabelOf("Maungawhau Train Station 4", { platformCode: "4" })).toBe("4");
  });

  it("labels a single-platform station from its code, which the name never carries", () => {
    // Onehunga is "Onehunga Train Station" with platform_code "1".
    expect(platformLabelOf("Onehunga Train Station", { platformCode: "1" })).toBe("1");
  });

  it("does not shorten a multi-character code to its last digit", () => {
    expect(platformLabelOf("Bay 13 Manukau Bus Station", { platformCode: "13" })).toBe("Bay 13");
    expect(platformLabelOf("Stop 2B Somewhere", { platformCode: "2B" })).toBe("Stop 2B");
  });

  it("falls back to a trailing number, then the name, when AT gives no code", () => {
    expect(platformLabelOf("Newmarket Train Station 2")).toBe("2");
    expect(platformLabelOf("Mayoral Dr/Queen St")).toBe("Mayoral Dr/Queen St");
  });

  it("is the inverse of stationName on the same row", () => {
    const rows = [
      { name: "Bay 23 Manukau Bus Station", platformCode: "23" },
      { name: "Stop A Hibiscus Coast", platformCode: "A" },
      { name: "Downtown Ferry Terminal Pier 1", platformCode: "1" },
      { name: "Newmarket Train Station 1", platformCode: "1" },
    ];
    for (const r of rows) {
      // Between them the two halves account for the code and the place, so
      // neither can silently drop it.
      expect(`${stationName(r.name, r)} ${platformLabelOf(r.name, r)}`).toContain(r.platformCode);
    }
  });
});

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

  // The four shapes AT writes a platform code in, each taken from a real row.
  it("strips a labelled prefix", () => {
    expect(stationName("Bay 23 Manukau Bus Station", { platformCode: "23" })).toBe(
      "Manukau Bus Station",
    );
    expect(stationName("Stop A Hibiscus Coast", { platformCode: "A" })).toBe("Hibiscus Coast");
  });

  it("strips a labelled suffix", () => {
    expect(stationName("Downtown Ferry Terminal Pier 1", { platformCode: "1" })).toBe(
      "Downtown Ferry Terminal",
    );
  });

  it("strips a bare suffix", () => {
    expect(stationName("Newmarket Train Station 1", { platformCode: "1" })).toBe(
      "Newmarket Train Station",
    );
  });

  it("leaves a name that does not contain its own code, which is already the place", () => {
    expect(stationName("Onehunga Train Station", { platformCode: "1" })).toBe(
      "Onehunga Train Station",
    );
  });

  it("takes a multi-character code off, without eating a longer number", () => {
    expect(stationName("Bay 2 Manukau Bus Station", { platformCode: "2" })).toBe(
      "Manukau Bus Station",
    );
    // "23" must not be shortened to "3" by a rule that matched a single digit.
    expect(stationName("Bay 23 Manukau Bus Station", { platformCode: "2" })).toBe(
      "Bay 23 Manukau Bus Station",
    );
  });
});

describe("stationNameOf", () => {
  it("names a place from its platforms", () => {
    expect(
      stationNameOf([
        { name: "Stop A Hibiscus Coast", platformCode: "A" },
        { name: "Stop B Hibiscus Coast", platformCode: "B" },
      ]),
    ).toBe("Hibiscus Coast");
  });

  it("takes the name most of the platforms agree on", () => {
    // One real parent holds both of these; without a rule the title would
    // depend on which row the merge happened to see first.
    expect(
      stationNameOf([
        { name: "Stop C Westfield Newmarket", platformCode: "C" },
        { name: "Stop E Newmarket Station", platformCode: "E" },
        { name: "Stop F Newmarket Station", platformCode: "F" },
      ]),
    ).toBe("Newmarket Station");
  });

  it("breaks an even split alphabetically, so the title does not move between renders", () => {
    const split = [
      { name: "Stop B Commerce Street/Quay Street", platformCode: "B" },
      { name: "Stop A Commerce Street/Galway Street", platformCode: "A" },
    ];
    expect(stationNameOf(split)).toBe("Commerce Street/Galway Street");
    expect(stationNameOf([...split].reverse())).toBe("Commerce Street/Galway Street");
  });

  it("returns an empty string when given no platforms", () => {
    expect(stationNameOf([])).toBe("");
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
  // separate bus-station parent, so the two collapse to two different places.
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

  it("sends the bus poles at a CRL station to the bus parent, not the rail one", () => {
    // AT models Te Waihorotiu as two parents, so the bus station and the train
    // station stay two places rather than being joined on their shared name.
    expect(
      stationId("7086-df733283", "Stop C Te Waihorotiu Station", {
        parentStation: "11014-9f0f7375",
        platformCode: "C",
      }),
    ).toBe("station:11014-9f0f7375");
    expect(
      stationId("9297-5284e223", "Te Waihorotiu Train Station 1", {
        parentStation: "131-50330e47",
        platformCode: "1",
      }),
    ).not.toBe("station:11014-9f0f7375");
  });

  it("leaves a pole the feed gave no parent on its own id", () => {
    expect(isPlatformStop("Stop C Te Waihorotiu Station", { platformCode: "C" })).toBe(false);
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
