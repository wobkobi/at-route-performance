// src/app/api/health/route.test.ts
// Handler test for GET /api/health: the deployed version, uncached.
import { GET } from "@/app/api/health/route";
import { describe, expect, it } from "vitest";
import pkg from "../../../../package.json";

describe("GET /api/health", () => {
  it("reports the package version and forbids caching", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { ok: boolean; version: string; time: string };
    expect(body.ok).toBe(true);
    expect(body.version).toBe(pkg.version);
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });
});
