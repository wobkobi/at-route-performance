// tests/lib/api-error.test.ts
// The shared API error envelope: its body shape, and which status and log line
// each kind of read failure gets.
import { apiError, readFailed } from "@/lib/api-error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("apiError", () => {
  it("puts the code and message last, so extra fields cannot overwrite them", async () => {
    const res = apiError(400, "invalid_query", "Bad.", { error: "spoofed", issues: [] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ issues: [], error: "invalid_query", message: "Bad." });
  });
});

describe("readFailed", () => {
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers an unreachable database with 503 under the alert marker, even upstream", async () => {
    const res = readFailed("api-live", new Error("connection refused"), {
      extra: { vehicles: [] },
      upstream: true,
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "database_unreachable", vehicles: [] });
    expect(error).toHaveBeenCalledWith("[DB-READ-FAILED] api-live", "connection refused");
  });

  it("answers an AT feed failure with 502 under [API], off the alert marker", async () => {
    const res = readFailed("api-live", new Error("AT vehicle locations 503"), { upstream: true });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "upstream_failed" });
    expect(error).toHaveBeenCalledWith("[API] api-live failed", "AT vehicle locations 503");
  });

  it("answers anything else with 500 and never sends the exception text", async () => {
    const res = readFailed("api-routes", new Error("secret detail"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
    expect(error).toHaveBeenCalledWith("[DB-READ-FAILED] api-routes", "secret detail");
  });
});
