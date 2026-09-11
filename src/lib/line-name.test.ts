// src/lib/line-name.test.ts
/**
 * @description Unit tests for the train-line display names in line-name.ts.
 */
import { lineName } from "@/lib/line-name";
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

  it("returns null for non-rail modes, so a bus sharing a code cannot match", () => {
    expect(lineName("BUS", "STH")).toBeNull();
    expect(lineName("FERRY", "ONE")).toBeNull();
  });

  it("returns null for unknown codes and missing short names", () => {
    expect(lineName("TRAIN", "NX1")).toBeNull();
    expect(lineName("TRAIN", null)).toBeNull();
    expect(lineName("TRAIN", undefined)).toBeNull();
    expect(lineName("TRAIN", "")).toBeNull();
  });
});
