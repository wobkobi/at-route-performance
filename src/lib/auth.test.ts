// src/lib/auth.test.ts
// Unit tests for the cron bearer-token guard.
import { requireCronAuth } from "@/lib/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A request to an ingest endpoint carrying the given Authorization header.
 * @param authorization - Header value, or undefined for none.
 * @returns The request.
 */
function request(authorization?: string): Request {
  return new Request("http://x/api/ingest/at", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("requireCronAuth", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CRON_SECRET;
  });

  it("fails closed with a 500 when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    const res = requireCronAuth(request("Bearer anything"));
    expect(res?.status).toBe(500);
    expect(await res?.json()).toEqual({ error: "Server misconfiguration" });
  });

  it("answers 401 to a missing or wrong token", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect(requireCronAuth(request())?.status).toBe(401);
    expect(requireCronAuth(request("Bearer nope"))?.status).toBe(401);
    expect(requireCronAuth(request("Bearer s3cre"))?.status).toBe(401);
    expect(await requireCronAuth(request("s3cret"))?.json()).toEqual({ error: "Unauthorized" });
  });

  it("lets the right token through", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(requireCronAuth(request("Bearer s3cret"))).toBeNull();
  });
});
