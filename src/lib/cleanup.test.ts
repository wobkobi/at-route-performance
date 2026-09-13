// src/lib/cleanup.test.ts
// Unit tests for the retention cutoff, the request rules and the delete run,
// driven through an in-memory store.
import { cleanupCutoff, parseCleanupParams, runCleanup, type CleanupStore } from "@/lib/cleanup";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

/** Instants per collection. */
interface Rows {
  events: Date[];
  trips: Date[];
  summaries: Date[];
}

/**
 * An in-memory store holding instants per collection; a delete removes the rows
 * before the cutoff and reports how many.
 * @param rows - Instants per collection.
 * @param failing - Collections whose delete throws.
 * @returns The store and the surviving rows.
 */
function fakeStore(rows: Rows, failing: (keyof Rows)[] = []): { store: CleanupStore; rows: Rows } {
  /**
   * A delete for one collection.
   * @param key - The collection.
   * @returns The delete, resolving to the count removed.
   */
  function remove(key: keyof Rows): (before: Date) => Promise<number> {
    return (before) => {
      if (failing.includes(key)) return Promise.reject(new Error(`${key} delete failed`));
      const keep = rows[key].filter((d) => d >= before);
      const removed = rows[key].length - keep.length;
      rows[key] = keep;
      return Promise.resolve(removed);
    };
  }
  /**
   * A count for one collection.
   * @param key - The collection.
   * @returns The count, resolving to the rows before the instant.
   */
  function count(key: keyof Rows): (before: Date) => Promise<number> {
    return (before) => Promise.resolve(rows[key].filter((d) => d < before).length);
  }
  /**
   * A fixed reading just past the warning threshold at the default allowance.
   * @returns The reading.
   */
  function storage(): Promise<{ dataMB: number; indexMB: number; objects: number }> {
    return Promise.resolve({ dataMB: 300, indexMB: 150, objects: 1_000_000 });
  }
  const store: CleanupStore = {
    countEvents: count("events"),
    countTrips: count("trips"),
    deleteEvents: remove("events"),
    deleteTrips: remove("trips"),
    deleteSummaries: remove("summaries"),
    storage,
  };
  return { store, rows };
}

describe("cleanupCutoff", () => {
  it("snaps to the 5am service-day start, not UTC midnight", () => {
    // 15 Jun 2026 12:00 NZST, retention 14 days > service day 1 Jun, which starts
    // at 05:00 NZST = 31 May 17:00 UTC.
    expect(cleanupCutoff(14, new Date("2026-06-15T00:00:00Z")).toISOString()).toBe(
      "2026-05-31T17:00:00.000Z",
    );
  });

  it("uses the offset in force on the cutoff day across the NZDT start", () => {
    // 5 Oct 2026 (NZDT) minus 14 days lands on 21 Sep (NZST): 05:00 NZST = 16:00 UTC.
    expect(cleanupCutoff(14, new Date("2026-10-04T23:00:00Z")).toISOString()).toBe(
      "2026-09-20T17:00:00.000Z",
    );
    // 13 Apr 2026 (NZST) minus 14 days lands on 30 Mar (NZDT): 05:00 NZDT = 16:00 UTC.
    expect(cleanupCutoff(14, new Date("2026-04-13T00:00:00Z")).toISOString()).toBe(
      "2026-03-29T16:00:00.000Z",
    );
  });

  it("rolls a pre-5am instant back to the previous service day", () => {
    // 15 Jun 03:00 NZST is still service day 14 Jun; 7 days back is 7 Jun 05:00 NZST.
    expect(cleanupCutoff(7, new Date("2026-06-14T15:00:00Z")).toISOString()).toBe(
      "2026-06-06T17:00:00.000Z",
    );
  });
});

/**
 * A cleanup request URL.
 * @param qs - Query string, with its leading `?` when present.
 * @returns The URL.
 */
function url(qs: string): URL {
  return new URL(`http://x/api/ingest/cleanup${qs}`);
}

describe("parseCleanupParams", () => {
  it("defaults to the environment, then to 14 days", () => {
    expect(parseCleanupParams(url(""), "21")).toEqual({
      ok: true,
      params: { retentionDays: 21, summaryDays: null },
    });
    expect(parseCleanupParams(url(""), undefined)).toEqual({
      ok: true,
      params: { retentionDays: 14, summaryDays: null },
    });
  });

  it("refuses retention under 7 days without ?force=1", () => {
    const refused = parseCleanupParams(url("?retentionDays=3"), undefined);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.refusal.error).toContain("requires ?force=1");
    expect(parseCleanupParams(url("?retentionDays=3&force=1"), undefined)).toEqual({
      ok: true,
      params: { retentionDays: 3, summaryDays: null },
    });
  });

  it("refuses nonsense values", () => {
    expect(parseCleanupParams(url("?retentionDays=abc"), undefined).ok).toBe(false);
    expect(parseCleanupParams(url("?retentionDays=0"), undefined).ok).toBe(false);
    expect(parseCleanupParams(url("?summaryDays=-1"), undefined).ok).toBe(false);
  });
});

describe("runCleanup", () => {
  const cutoff = new Date("2026-06-01T17:00:00Z");
  const old = new Date("2026-05-20T00:00:00Z");
  const recent = new Date("2026-06-10T00:00:00Z");

  it("deletes only rows before the cutoff in every collection", async () => {
    const { store, rows } = fakeStore({
      events: [old, old, recent],
      trips: [old, recent],
      summaries: [old, recent],
    });
    const outcome = await runCleanup(store, cutoff, 14, 512, new Date("2026-06-15T00:00:00Z"));
    expect(outcome.deletedEvents).toBe(2);
    expect(outcome.deletedTrips).toBe(1);
    expect(outcome.deletedSummaries).toBe(1);
    expect(rows.events).toEqual([recent]);
    expect(outcome.firstError).toBeNull();
    expect(outcome.storageWarning).toBe(true);
  });

  it("leaves the summaries alone when no summary retention is given", async () => {
    const { store, rows } = fakeStore({ events: [old], trips: [old], summaries: [old] });
    const outcome = await runCleanup(store, cutoff, null, 2048);
    expect(outcome.deletedSummaries).toBe(0);
    expect(rows.summaries).toEqual([old]);
    expect(outcome.storageWarning).toBe(false);
  });

  it("carries on past a failed collection and reports the failure", async () => {
    const { store, rows } = fakeStore({ events: [old], trips: [old], summaries: [old] }, ["trips"]);
    const outcome = await runCleanup(store, cutoff, 14, 512, new Date("2026-06-15T00:00:00Z"));
    expect(outcome.deletedEvents).toBe(1);
    expect(outcome.deletedTrips).toBe(0);
    expect(outcome.deletedSummaries).toBe(1);
    expect(rows.trips).toEqual([old]);
    expect(outcome.errors).toEqual({ trips: "trips delete failed" });
    expect(outcome.firstError).toBe("trips delete failed");
  });
});
