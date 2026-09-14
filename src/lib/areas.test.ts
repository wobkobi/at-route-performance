// src/lib/areas.test.ts
// Unit tests for placing stops and routes in Auckland's broad areas.
import { areaOf, routeAreas, type AreaKey } from "@/lib/areas";
import { describe, expect, it } from "vitest";

/** Known places and the area each should land in: [name, lat, lon, area]. */
const PLACES: ReadonlyArray<[string, number, number, AreaKey]> = [
  ["Britomart", -36.844, 174.767, "central"],
  ["Westhaven", -36.8385, 174.745, "central"],
  ["Point Chevalier", -36.87, 174.71, "central"],
  ["Avondale", -36.897, 174.698, "central"],
  ["Onehunga", -36.924, 174.785, "central"],
  ["Sylvia Park", -36.917, 174.841, "central"],
  ["Glen Innes", -36.878, 174.855, "central"],
  ["Panmure", -36.898, 174.853, "central"],
  ["Glendowie", -36.857, 174.874, "central"],
  ["Glendowie Road", -36.8619, 174.8802, "central"],
  ["Devonport", -36.83, 174.795, "north"],
  ["Birkenhead wharf", -36.8284, 174.73, "north"],
  ["Takapuna", -36.788, 174.77, "north"],
  ["Albany", -36.728, 174.699, "north"],
  ["Greenhithe", -36.777, 174.678, "north"],
  ["Paremoremo", -36.765, 174.66, "north"],
  ["Hobsonville Point", -36.7925, 174.6613, "west"],
  ["Hobsonville Point ferry terminal", -36.7876, 174.6722, "west"],
  ["Te Atatu Peninsula", -36.83, 174.65, "west"],
  ["Henderson", -36.88, 174.63, "west"],
  ["New Lynn", -36.9077, 174.6847, "west"],
  ["Titirangi", -36.94, 174.655, "west"],
  ["Kumeu", -36.776, 174.557, "west"],
  ["Pakuranga", -36.912, 174.872, "east"],
  ["Howick", -36.895, 174.93, "east"],
  ["Botany", -36.934, 174.912, "east"],
  ["Ormiston Town Centre", -36.966, 174.9145, "east"],
  ["Flat Bush School Road", -36.9729, 174.9131, "east"],
  ["Beachlands", -36.88, 175.0, "east"],
  ["Mangere Bridge", -36.938, 174.785, "south"],
  ["Otahuhu", -36.947, 174.84, "south"],
  ["Otara", -36.96, 174.875, "south"],
  ["Manukau", -36.993, 174.88, "south"],
  ["Papakura", -37.065, 174.945, "south"],
  ["Pukekohe", -37.2, 174.9, "south"],
  ["Airport", -37.008, 174.785, "south"],
  ["Silverdale", -36.62, 174.675, "hibiscus-rodney"],
  ["Gulf Harbour", -36.62, 174.79, "hibiscus-rodney"],
  ["Helensville", -36.68, 174.45, "hibiscus-rodney"],
  ["Matiatia", -36.78, 174.99, "waiheke"],
];

describe("areaOf", () => {
  it.each(PLACES)("puts %s in its area", (_name, lat, lon, area) => {
    expect(areaOf(lat, lon)).toBe(area);
  });
});

describe("routeAreas", () => {
  const city = { lat: -36.844, lon: 174.767 };
  const shore = { lat: -36.788, lon: 174.77 };
  const waiheke = { lat: -36.78, lon: 174.99 };

  it("lists every area holding at least two stops, in display order", () => {
    expect(routeAreas([shore, shore, shore, city, city])).toEqual(["central", "north"]);
  });

  it("ignores a single stop just over a boundary on a long route", () => {
    const stops = [...Array.from({ length: 12 }, () => shore), city];
    expect(routeAreas(stops)).toEqual(["north"]);
  });

  it("keeps both ends of a two-stop ferry", () => {
    expect(routeAreas([city, waiheke])).toEqual(["central", "waiheke"]);
  });

  it("returns nothing without stops", () => {
    expect(routeAreas([])).toEqual([]);
  });
});
