// tests/lib/route/line-name.test.ts
// Unit tests for the train-line display names in line-name.ts.

import { lineName } from "@/lib/route/line-name";
import { describe, expect, it } from "vitest";

describe("lineName", () => {
  it("names the lines running until the CRL cutover", () => {
    expect(lineName("TRAIN", "STH")).toBe("Southern Line");
    expect(lineName("TRAIN", "EAST")).toBe("Eastern Line");
    expect(lineName("TRAIN", "WEST")).toBe("Western Line");
    expect(lineName("TRAIN", "ONE")).toBe("Onehunga Line");
  });

  it("names the CRL lines, hyphenated or not", () => {
    expect(lineName("TRAIN", "S-C")).toBe("South City Line");
    expect(lineName("TRAIN", "SC")).toBe("South City Line");
    expect(lineName("TRAIN", "E-W")).toBe("East West Line");
    expect(lineName("TRAIN", "O-W")).toBe("Onehunga West Line");
  });

  it("names the Waikato regional service", () => {
    expect(lineName("TRAIN", "HUIA")).toBe("Te Huia");
  });

  it("is case-insensitive", () => {
    expect(lineName("TRAIN", "sth")).toBe("Southern Line");
    expect(lineName("TRAIN", "o-w")).toBe("Onehunga West Line");
  });

  it("names the branded bus services", () => {
    expect(lineName("BUS", "CTY")).toBe("CityLink");
    expect(lineName("BUS", "tmk")).toBe("TāmakiLink");
    expect(lineName("BUS", "NX2")).toBe("Northern Express");
  });

  it("keeps each mode's names to its own routes", () => {
    expect(lineName("BUS", "STH")).toBeNull();
    expect(lineName("FERRY", "ONE")).toBeNull();
    expect(lineName("TRAIN", "CTY")).toBeNull();
    expect(lineName("FERRY", "OUT")).toBeNull();
  });

  it("returns null for unknown codes and missing short names", () => {
    expect(lineName("TRAIN", "NX1")).toBeNull();
    expect(lineName("TRAIN", null)).toBeNull();
    expect(lineName("TRAIN", undefined)).toBeNull();
    expect(lineName("TRAIN", "")).toBeNull();
  });
});
