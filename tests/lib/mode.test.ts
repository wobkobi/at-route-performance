// tests/lib/mode.test.ts
// Unit tests for the shared mode list, parser and labels.
import { isMode, MODE_NAME, MODE_NOUN, modeOrBus, MODES, modeWord, parseMode } from "@/lib/mode";
import { describe, expect, it } from "vitest";

describe("parseMode", () => {
  it("accepts each mode", () => {
    for (const mode of MODES) expect(parseMode(mode)).toBe(mode);
  });

  it("reads anything else as no filter", () => {
    expect(parseMode(undefined)).toBeNull();
    expect(parseMode(null)).toBeNull();
    expect(parseMode("")).toBeNull();
    expect(parseMode("bus")).toBeNull();
    expect(parseMode("TRAM")).toBeNull();
  });
});

describe("isMode", () => {
  it("rejects non-strings", () => {
    expect(isMode(3)).toBe(false);
    expect(isMode({})).toBe(false);
    expect(isMode("FERRY")).toBe(true);
  });
});

describe("modeOrBus", () => {
  it("keeps a known mode and reads the rest as a bus", () => {
    expect(modeOrBus("TRAIN")).toBe("TRAIN");
    expect(modeOrBus("TRAM")).toBe("BUS");
    expect(modeOrBus(null)).toBe("BUS");
  });
});

describe("labels", () => {
  it("names every mode", () => {
    for (const mode of MODES) {
      expect(MODE_NAME[mode]).toBeTruthy();
      expect(MODE_NOUN[mode]).toBeTruthy();
    }
  });

  it("gives lower-case words for prose", () => {
    expect(modeWord("BUS")).toBe("bus");
    expect(modeWord("BUS", true)).toBe("buses");
    expect(modeWord("FERRY", true)).toBe("ferries");
  });
});
