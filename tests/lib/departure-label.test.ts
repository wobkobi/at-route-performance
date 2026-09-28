import { departureLabel } from "@/lib/departure-label";
import { describe, expect, it } from "vitest";

describe("departureLabel", () => {
  it("drops the origin and splits the via", () => {
    expect(departureLabel("City Centre To New Lynn Via Great North Rd", "NEW LYNN", "BUS")).toEqual(
      {
        destination: "New Lynn",
        via: "Great North Rd",
      },
    );
  });

  it("reads the same headsign in lower case", () => {
    expect(departureLabel("Lincoln Rd to New Lynn via Henderson", "NEW LYNN", "BUS")).toEqual({
      destination: "New Lynn",
      via: "Henderson",
    });
  });

  it("keeps a compound origin out of the destination", () => {
    expect(
      departureLabel(
        "New Lynn And Blockhouse Bay To City Centre Via Sandringham R",
        "CITY CENTRE",
        "BUS",
      ),
    ).toEqual({ destination: "City Centre", via: "Sandringham R" });
  });

  it("names a headsign with no via", () => {
    expect(departureLabel("Britomart To Onehunga", "ONEHUNGA", "BUS")).toEqual({
      destination: "Onehunga",
      via: null,
    });
  });

  it("strips a train's platform numbers before splitting", () => {
    expect(
      departureLabel(
        "Henderson 1 To Manukau 1 Via Waitemata 1",
        "Manukau via City Centre",
        "TRAIN",
      ),
    ).toEqual({ destination: "Manukau", via: "Waitemata" });
  });

  it("leaves a bus headsign's numbers alone", () => {
    expect(departureLabel("Botany To Highland Park 2 Via Pakuranga", null, "BUS")).toEqual({
      destination: "Highland Park 2",
      via: "Pakuranga",
    });
  });

  // Measured at Freemans Bay School on 25 Sep 2026: all 37 departures carry this
  // pair, and "Britomart" is the only one of the two a waiting rider can use.
  it("answers a loop from the stop's own headsign", () => {
    expect(departureLabel("Freemans Bay Loop", "BRITOMART", "BUS")).toEqual({
      destination: "Britomart",
      via: null,
    });
  });

  it("answers a Link the same way", () => {
    expect(departureLabel("Inner Link Clockwise", "INNER LINK", "BUS")).toEqual({
      destination: "Inner Link",
      via: null,
    });
  });

  it("keeps a plainly written headsign as it is", () => {
    expect(departureLabel("South Lynn Loop", "Onehunga via Grafton", "TRAIN")).toEqual({
      destination: "Onehunga via Grafton",
      via: null,
    });
  });

  it("falls back to the trip headsign when the stop names nothing", () => {
    expect(departureLabel("Royal Heights Loop", null, "BUS")).toEqual({
      destination: "Royal Heights Loop",
      via: null,
    });
  });

  it("says nothing rather than empty when AT names neither", () => {
    expect(departureLabel(null, null, "BUS")).toEqual({ destination: null, via: null });
  });

  it("does not read a place name as the word to", () => {
    expect(departureLabel("Papatoetoe To Otahuhu", null, "BUS")).toEqual({
      destination: "Otahuhu",
      via: null,
    });
  });
});
