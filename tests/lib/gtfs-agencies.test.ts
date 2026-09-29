// tests/lib/gtfs-agencies.test.ts
import {
  mergeAgencies,
  operatorName,
  operatorSlug,
  parseAgencies,
  parseStoredAgencies,
} from "@/lib/gtfs-agencies";
import type { Operator } from "@/lib/operators";
import { describe, expect, it } from "vitest";

const HEADER =
  "agency_id,agency_name,agency_url,agency_timezone,agency_lang,agency_phone,agency_fare_url,agency_email";

describe("parseAgencies", () => {
  it("reads code and name, past a byte-order mark and a quoted comma", () => {
    const txt = `\uFEFF${HEADER}\r\nNZB,New Zealand Bus,http://x,Pacific/Auckland,en,,,\r\nABC,"Smith, Jones ""and"" Co",http://x,Pacific/Auckland,en,,,\r\n\r\n`;
    expect(parseAgencies(txt)).toEqual([
      { code: "NZB", name: "New Zealand Bus" },
      { code: "ABC", name: 'Smith, Jones "and" Co' },
    ]);
  });

  it("gives nothing for a file without the columns", () => {
    expect(parseAgencies("foo,bar\n1,2")).toEqual([]);
  });
});

describe("operatorName and operatorSlug", () => {
  it("drops a company suffix and joins words with hyphens", () => {
    expect(operatorName("Tranzit Group Ltd")).toBe("Tranzit Group");
    expect(operatorName("Acme Limited")).toBe("Acme");
    expect(operatorSlug("Howick and Eastern")).toBe("howick-and-eastern");
    expect(operatorSlug("Fullers360")).toBe("fullers360");
    expect(operatorSlug("!!")).toBe("");
  });
});

describe("mergeAgencies", () => {
  const stored: Operator[] = [
    { code: "FGL", name: "Fullers360", slug: "fullers360", current: true },
    { code: "RTH", name: "Ritchies Transport", slug: "ritchies-transport", current: true },
  ];

  it("keeps a renamed operator's slug", () => {
    const out = mergeAgencies(stored, [
      { code: "FGL", name: "Fullers Group" },
      { code: "RTH", name: "Ritchies Transport" },
    ]);
    expect(out.find((o) => o.code === "FGL")).toEqual({
      code: "FGL",
      name: "Fullers Group",
      slug: "fullers360",
      current: true,
    });
  });

  it("adds a new operator under a slug from its name, and keeps a dropped one as not current", () => {
    const out = mergeAgencies(stored, [
      { code: "FGL", name: "Fullers360" },
      { code: "TZG", name: "Tranzit Group Ltd" },
    ]);
    expect(out).toEqual([
      { code: "FGL", name: "Fullers360", slug: "fullers360", current: true },
      { code: "RTH", name: "Ritchies Transport", slug: "ritchies-transport", current: false },
      { code: "TZG", name: "Tranzit Group", slug: "tranzit-group", current: true },
    ]);
  });

  it("suffixes a new slug another operator already holds", () => {
    const out = mergeAgencies(stored, [{ code: "FX", name: "Fullers360" }]);
    expect(out.find((o) => o.code === "FX")?.slug).toBe("fullers360-fx");
  });

  it("brings a dropped operator back as current under its old slug", () => {
    const dropped = stored.map((o) => ({ ...o, current: false }));
    const out = mergeAgencies(dropped, [{ code: "RTH", name: "Ritchies" }]);
    expect(out.find((o) => o.code === "RTH")).toEqual({
      code: "RTH",
      name: "Ritchies",
      slug: "ritchies-transport",
      current: true,
    });
  });
});

describe("parseStoredAgencies", () => {
  it("keeps well-formed entries and gives nothing for a bad value", () => {
    const good = { code: "NZB", name: "New Zealand Bus", slug: "new-zealand-bus", current: true };
    expect(parseStoredAgencies(JSON.stringify([good, { code: 1 }]))).toEqual([good]);
    expect(parseStoredAgencies(null)).toEqual([]);
    expect(parseStoredAgencies("{not json")).toEqual([]);
    expect(parseStoredAgencies('{"a":1}')).toEqual([]);
  });
});
