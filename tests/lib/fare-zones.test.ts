// tests/lib/fare-zones.test.ts
import { fareZonesOf, routeFareZones } from "@/lib/fare-zone-geo";
import { FARE_ZONES, isFareZoneKey } from "@/lib/fare-zones";
import ZONES from "@/lib/fare-zones.json";
import { describe, expect, it } from "vitest";

describe("fareZonesOf", () => {
  it("places stops in their zone", () => {
    expect(fareZonesOf(-36.8443, 174.7676)).toEqual(["city"]); // Britomart
    expect(fareZonesOf(-36.788, 174.773)).toEqual(["lower-north-shore"]); // Takapuna
    expect(fareZonesOf(-36.88, 174.63)).toEqual(["waitakere"]); // Henderson
    expect(fareZonesOf(-37.203, 174.903)).toEqual(["southern-manukau"]); // Pukekohe
    expect(fareZonesOf(-36.78, 174.993)).toEqual(["waiheke"]); // Matiatia
  });

  it("puts a stop on an overlap in both zones", () => {
    expect(fareZonesOf(-36.8698, 174.778)).toEqual(["city", "isthmus"]); // Newmarket
    expect(fareZonesOf(-36.924, 174.786)).toEqual(["isthmus", "northern-manukau"]); // Onehunga
  });

  it("adds the zone AT's published list gives a stop the polygons miss, only at that pole", () => {
    // Stop 8503 sits 17 m outside the Isthmus polygon but is on AT's City/Isthmus overlap list.
    expect(fareZonesOf(-36.86776, 174.76118)).toEqual(["city", "isthmus"]);
    // About 50 m west, the polygons alone decide.
    expect(fareZonesOf(-36.86776, 174.76062)).toEqual(["city"]);
  });

  it("finds no zone out at sea", () => {
    expect(fareZonesOf(-36.5, 175.5)).toEqual([]);
  });
});

describe("routeFareZones", () => {
  it("lists every zone a stop is in, in display order, once", () => {
    const stops = [
      { lat: -36.924, lon: 174.786 },
      { lat: -36.8443, lon: 174.7676 },
      { lat: -36.8698, lon: 174.778 },
    ];
    expect(routeFareZones(stops)).toEqual(["city", "isthmus", "northern-manukau"]);
  });
});

describe("zone table", () => {
  it("matches the polygon file key for key, in order", () => {
    expect(ZONES.map((z) => z.key)).toEqual(FARE_ZONES.map((z) => z.key));
    expect(isFareZoneKey("city")).toBe(true);
    expect(isFareZoneKey("mars")).toBe(false);
  });
});
