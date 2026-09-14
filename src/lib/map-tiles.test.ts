// src/lib/map-tiles.test.ts
// Unit tests for choosing when the CARTO key goes out with tile requests.
import { cartoTileUrl } from "@/lib/map-tiles";
import { describe, expect, it } from "vitest";

const PROD = "at-route-performance.vercel.app";

describe("cartoTileUrl", () => {
  it("sends the key from the production domain", () => {
    expect(cartoTileUrl(PROD, "k 1", PROD)).toMatch(/\{r\}\.png\?key=k%201$/);
  });

  it("leaves the key off a deployment's own URL, which the restricted key refuses", () => {
    expect(cartoTileUrl("at-route-performance-4ouf1jwdg-team.vercel.app", "k", PROD)).not.toContain(
      "key=",
    );
  });

  it("sends the key anywhere when there is no production domain to compare", () => {
    expect(cartoTileUrl("localhost:3000", "k", undefined)).toContain("key=k");
  });

  it("requests keyless tiles without a key", () => {
    expect(cartoTileUrl(PROD, undefined, PROD)).not.toContain("key=");
  });
});
