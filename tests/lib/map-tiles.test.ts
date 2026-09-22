// tests/lib/map-tiles.test.ts
// Unit tests for choosing when the CARTO key goes out with tile requests.
import { cartoTileUrl } from "@/lib/map-tiles";
import { describe, expect, it } from "vitest";

const PROD = "at-route-performance.vercel.app";
const BRANCH = "at-route-performance-git-dev-team.vercel.app";

describe("cartoTileUrl", () => {
  it("sends the key from the production domain", () => {
    expect(cartoTileUrl(PROD, "k 1", [PROD, BRANCH])).toMatch(/\{r\}\.png\?key=k%201$/);
  });

  it("sends the key from the branch's preview alias", () => {
    expect(cartoTileUrl(BRANCH, "k", [PROD, BRANCH])).toContain("key=k");
  });

  it("leaves the key off a deployment's own URL, which the restricted key refuses", () => {
    expect(
      cartoTileUrl("at-route-performance-4ouf1jwdg-team.vercel.app", "k", [PROD, BRANCH]),
    ).not.toContain("key=");
  });

  it("sends the key off Vercel, where there is no production domain to compare", () => {
    expect(cartoTileUrl("transit.example.nz", "k", [undefined, undefined])).toContain("key=k");
  });

  it("leaves the key off loopback, which CARTO cannot allow-list", () => {
    expect(cartoTileUrl("localhost:3000", "k", [])).not.toContain("key=");
    expect(cartoTileUrl("127.0.0.1:3100", "k", [])).not.toContain("key=");
    expect(cartoTileUrl("[::1]:3000", "k", [PROD])).not.toContain("key=");
  });

  it("requests keyless tiles without a key", () => {
    expect(cartoTileUrl(PROD, undefined, [PROD])).not.toContain("key=");
  });
});
