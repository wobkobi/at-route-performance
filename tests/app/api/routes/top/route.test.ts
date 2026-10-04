// tests/app/api/routes/top/route.test.ts
// Handler tests for GET /api/routes/top: defaults, the sanitised 400 body and
// the shared error envelope, with the exception text kept to the log.
import { GET } from "@/app/api/routes/top/route";
import { getTopRoutes } from "@/lib/data";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data", () => ({ getTopRoutes: vi.fn() }));

const mockedTopRoutes = vi.mocked(getTopRoutes);

describe("GET /api/routes/top", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockedTopRoutes.mockReset();
  });

  it("reads an empty limit as the default and returns the rows", async () => {
    mockedTopRoutes.mockResolvedValue([]);
    const res = await GET(new Request("http://x/api/routes/top?limit="));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(mockedTopRoutes).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it("answers an invalid query with the field and message only", async () => {
    const res = await GET(new Request("http://x/api/routes/top?limit=abc"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: Record<string, unknown>[] };
    expect(body.error).toBe("invalid_query");
    expect(body.issues).toHaveLength(1);
    expect(Object.keys(body.issues[0] ?? {}).sort()).toEqual(["message", "path"]);
    expect(body.issues[0]?.path).toBe("limit");
    expect(mockedTopRoutes).not.toHaveBeenCalled();
  });

  it("answers an unreachable database with 503 and keeps the address out of the body", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedTopRoutes.mockRejectedValue(new Error("connection refused at 10.0.0.9:27019"));
    const res = await GET(new Request("http://x/api/routes/top"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "database_unreachable",
      message: "The database could not be reached.",
    });
    expect(error).toHaveBeenCalledWith(
      "[DB-READ-FAILED] api-routes-top",
      "connection refused at 10.0.0.9:27019",
    );
  });

  it("answers any other failure with a 500 in the envelope", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedTopRoutes.mockRejectedValue(new Error("pipeline stage invalid"));
    const res = await GET(new Request("http://x/api/routes/top"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error", message: "The request failed." });
  });
});
