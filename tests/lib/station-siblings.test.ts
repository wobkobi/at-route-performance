// tests/lib/station-siblings.test.ts
/// Unit tests for cross-linking the parents AT gives one place, in station-siblings.ts.
// The fixtures are AT's real parents, names and centroids as measured on
// 24 September 2026, so a case that matters here is a case that exists.
import {
  SIBLING_MAX_METRES,
  type StationPlace,
  placeOf,
  siblingsByStation,
} from "@/lib/station-siblings";
import { describe, expect, it } from "vitest";

/**
 * Build a parent for the fixtures.
 * @param id - The parent's station id, without the `station:` prefix.
 * @param name - AT's name for the parent.
 * @param lat - Latitude of the parent's centre.
 * @param lon - Longitude of the parent's centre.
 * @param platforms - How many platforms it holds.
 * @returns The parent in the shape the rule takes.
 */
function place(id: string, name: string, lat: number, lon: number, platforms = 1): StationPlace {
  return { id: `station:${id}`, name, lat, lon, platforms };
}

/** Otahuhu: a bus and a rail parent 55 m apart, and a same-named pair 998 m away. */
const OTAHUHU = [
  place("61139-1ae9234a", "Otahuhu Station", -36.94698, 174.83371, 4),
  place("101-9ef61446", "Otahuhu Train Station", -36.94669, 174.83321, 3),
  place("51338-cad5d924", "Otahuhu", -36.94288, 174.84338, 2),
];

/** Manukau: three parents within 112 m, each with a name of its own. */
const MANUKAU = [
  place("51252-1843ab98", "Manukau Bus Station", -36.99358, 174.87859, 23),
  place("51239-18c41359", "Manukau Station", -36.99343, 174.87772, 2),
  place("9218-cd379d59", "Manukau Train Station", -36.99388, 174.87739, 2),
];

/** Glen Innes: one train station and three single-pole parents AT gives the same name. */
const GLEN_INNES = [
  place("103-be3d2b7e", "Glen Innes Train Station", -36.8788, 174.85412, 2),
  place("31339-d39a861c", "Glen Innes Station", -36.87861, 174.85439),
  place("11929-d39a861c", "Glen Innes Station", -36.87806, 174.85454),
  place("11930-d39a861c", "Glen Innes Station", -36.87978, 174.85491),
];

describe("placeOf", () => {
  it("removes the facility word AT ended the name with", () => {
    expect(placeOf("Manukau Train Station")).toBe("Manukau");
    expect(placeOf("Lincoln Bus Interchange")).toBe("Lincoln");
    expect(placeOf("Downtown Ferry Terminal")).toBe("Downtown");
    expect(placeOf("Otahuhu Station")).toBe("Otahuhu");
    expect(placeOf("Hobsonville Point Wharf")).toBe("Hobsonville Point");
  });

  it("takes the longest facility word, so a two-word one keeps its first half out", () => {
    expect(placeOf("Manukau Bus Station")).toBe("Manukau");
    expect(placeOf("Albany Bus Station")).toBe("Albany");
  });

  it("leaves a name carrying no facility word alone", () => {
    expect(placeOf("Onehunga")).toBe("Onehunga");
    expect(placeOf("St Lukes")).toBe("St Lukes");
    expect(placeOf("Otahuhu Town Centre")).toBe("Otahuhu Town Centre");
  });
});

describe("siblingsByStation", () => {
  it("links Otahuhu's bus and rail parents to each other", () => {
    const map = siblingsByStation(OTAHUHU);
    expect(map.get("station:61139-1ae9234a")).toEqual({
      place: "Otahuhu",
      siblings: [{ id: "station:101-9ef61446", name: "Otahuhu Train Station" }],
    });
    expect(map.get("station:101-9ef61446")?.siblings).toEqual([
      { id: "station:61139-1ae9234a", name: "Otahuhu Station" },
    ]);
  });

  it("leaves out a parent that shares the name but not the place", () => {
    // AT calls a pair of poles a kilometre up the road "Otahuhu" too. Sharing a
    // name is not being the same interchange, which is what the distance is for.
    const map = siblingsByStation(OTAHUHU);
    expect(map.has("station:51338-cad5d924")).toBe(false);
    for (const s of map.get("station:101-9ef61446")?.siblings ?? []) {
      expect(s.id).not.toBe("station:51338-cad5d924");
    }
  });

  it("links all three of Manukau's parents to each other", () => {
    const map = siblingsByStation(MANUKAU);
    expect(map.get("station:51252-1843ab98")?.siblings.map((s) => s.name)).toEqual([
      "Manukau Station",
      "Manukau Train Station",
    ]);
    expect(map.get("station:9218-cd379d59")?.siblings.map((s) => s.name)).toEqual([
      "Manukau Bus Station",
      "Manukau Station",
    ]);
  });

  it("offers a name once, however many parents carry it", () => {
    // Three parents are called "Glen Innes Station", so three links reading
    // "Glen Innes Station" would give the reader nothing to choose between.
    const map = siblingsByStation(GLEN_INNES);
    expect(map.get("station:103-be3d2b7e")?.siblings).toEqual([
      { id: "station:11929-d39a861c", name: "Glen Innes Station" },
    ]);
  });

  it("sends a shared name to the parent holding the most platforms", () => {
    const map = siblingsByStation([
      place("a-1", "Papatoetoe Train Station", -36.97717, 174.84995, 2),
      place("b-2", "Papatoetoe Station", -36.97731, 174.84944, 1),
      place("c-3", "Papatoetoe Station", -36.97745, 174.85008, 3),
    ]);
    expect(map.get("station:a-1")?.siblings).toEqual([
      { id: "station:c-3", name: "Papatoetoe Station" },
    ]);
  });

  it("does not link a place whose parents all share one name", () => {
    // St Lukes is three parents, every one of them "St Lukes": a link labelled
    // with the page's own title is not a way anywhere.
    const map = siblingsByStation([
      place("a-1", "St Lukes", -36.87205, 174.73246, 2),
      place("b-2", "St Lukes", -36.87262, 174.73257),
      place("c-3", "St Lukes", -36.87415, 174.73217, 3),
    ]);
    expect(map.size).toBe(0);
  });

  it("does not link a parent that is the only one of its place", () => {
    const map = siblingsByStation([
      place("a-1", "Hibiscus Coast", -36.61558, 174.68003, 8),
      place("b-2", "Albany Bus Station", -36.7229, 174.70012, 6),
    ]);
    expect(map.size).toBe(0);
  });

  it("stops at the distance bound", () => {
    // A tenth of a degree of latitude is ~111 m, so these two sit ~222 m apart.
    const near = siblingsByStation([
      place("a-1", "Papakura Station", -37.0, 174.9),
      place("b-2", "Papakura Train Station", -37.002, 174.9),
    ]);
    expect(near.size).toBe(2);

    // ~556 m apart, past the bound.
    const far = siblingsByStation([
      place("a-1", "Papakura Station", -37.0, 174.9),
      place("b-2", "Papakura Train Station", -37.005, 174.9),
    ]);
    expect(far.size).toBe(0);
    expect(SIBLING_MAX_METRES).toBe(400);
  });

  it("gives the same links whichever order the parents arrive in", () => {
    const forward = siblingsByStation(GLEN_INNES);
    const reversed = siblingsByStation([...GLEN_INNES].reverse());
    for (const id of forward.keys()) {
      expect(reversed.get(id)).toEqual(forward.get(id));
    }
    expect(reversed.size).toBe(forward.size);
  });
});
