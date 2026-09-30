// tests/lib/feed/ingest-lease.test.ts
// The realtime poll's lease: a claim takes an expired or missing lease in one
// upsert, a live lease refuses it with a duplicate key, and a database that
// cannot be asked lets the poll run unleased so its writes still reach the spool.
import { claimIngestLease, LEASE_MS, releaseIngestLease, UNLEASED } from "@/lib/feed/ingest-lease";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The raw command the lease sends. Hoisted so the module mock closes over it. */
const runCommandRaw = vi.hoisted(() => vi.fn<(cmd: unknown) => Promise<unknown>>());

vi.mock("@/lib/db", () => ({ prisma: { $runCommandRaw: runCommandRaw } }));

beforeEach(() => {
  runCommandRaw.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("claimIngestLease", () => {
  it("takes the lease with an upsert that matches only an expired claim", async () => {
    runCommandRaw.mockResolvedValue({ ok: 1 });
    const now = Date.UTC(2026, 8, 26, 10, 0, 0);
    const token = await claimIngestLease(now);

    expect(token).toMatch(/^\d+-/);
    const cmd = runCommandRaw.mock.calls[0]![0] as {
      query: { until: { $lt: { $date: string } } };
      update: { $set: { value: string; until: { $date: string } } };
      upsert: boolean;
    };
    expect(cmd.upsert).toBe(true);
    expect(cmd.query.until.$lt.$date).toBe(new Date(now).toISOString());
    expect(cmd.update.$set.value).toBe(token);
    expect(cmd.update.$set.until.$date).toBe(new Date(now + LEASE_MS).toISOString());
  });

  it("answers null while another poll holds the lease", async () => {
    runCommandRaw.mockRejectedValue(new Error("E11000 duplicate key error collection: setting"));
    expect(await claimIngestLease()).toBeNull();
  });

  it("lets the poll run unleased when the database cannot be asked", async () => {
    runCommandRaw.mockRejectedValue(new Error("Server selection timeout"));
    expect(await claimIngestLease()).toBe(UNLEASED);
  });
});

describe("releaseIngestLease", () => {
  it("releases only the claim that carries this poll's token", async () => {
    runCommandRaw.mockResolvedValue({ ok: 1 });
    await releaseIngestLease("abc");
    const cmd = runCommandRaw.mock.calls[0]![0] as { updates: { q: { value: string } }[] };
    expect(cmd.updates[0]!.q.value).toBe("abc");
  });

  it("sends nothing for an unleased poll", async () => {
    await releaseIngestLease(UNLEASED);
    expect(runCommandRaw).not.toHaveBeenCalled();
  });
});
