// src/lib/cleanup.test.ts
// Unit tests for the retention cutoff, the request rules and the delete run,
// driven through an in-memory store.
import {
  buildCleanupPlan,
  checkCleanupPlan,
  cleanupCutoff,
  MAX_CUTOFF_ADVANCE_DAYS,
  MAX_DELETE_SHARE,
  MIN_SAFE_RETENTION_DAYS,
  parseCleanupParams,
  pickLastAppliedCutoff,
  runCleanup,
  type CleanupParams,
  type CleanupStore,
} from "@/lib/cleanup";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

/** Instants per collection. */
interface Rows {
  events: Date[];
  trips: Date[];
  summaries: Date[];
  sightings?: Date[];
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
      const all = rows[key] ?? [];
      const keep = all.filter((d) => d >= before);
      const removed = all.length - keep.length;
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
    return (before) => Promise.resolve((rows[key] ?? []).filter((d) => d < before).length);
  }
  /**
   * Every event held, for the share guard's denominator.
   * @returns The count.
   */
  function countAll(): Promise<number> {
    return Promise.resolve(rows.events.length);
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
    countAllEvents: countAll,
    countTrips: count("trips"),
    deleteEvents: remove("events"),
    deleteTrips: remove("trips"),
    deleteSummaries: remove("summaries"),
    deleteSightings: remove("sightings"),
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
  it("refuses when RETENTION_DAYS is unset or empty", () => {
    // The whole point of the task: a missing variable must refuse, not mean 14
    // days. There is deliberately no DEFAULT_RETENTION_DAYS to fall back to.
    for (const env of [undefined, "", "   "]) {
      const refused = parseCleanupParams(url(""), env);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.refusal.error).toContain("RETENTION_DAYS");
    }
  });

  it("takes the environment, and lets the query parameter override it", () => {
    expect(parseCleanupParams(url(""), "3652")).toEqual({
      ok: true,
      params: { retentionDays: 3652, summaryDays: null, force: false, dryRun: false },
    });
    expect(parseCleanupParams(url("?retentionDays=400"), "3652")).toEqual({
      ok: true,
      params: { retentionDays: 400, summaryDays: null, force: false, dryRun: false },
    });
  });

  it("refuses retention below the floor even with ?force=1", () => {
    // The 26 September regression: RETENTION_DAYS lost its value, the code read
    // 14, and a ten-year archive was one cron run from gone.
    for (const qs of ["?retentionDays=14", "?retentionDays=14&force=1"]) {
      const refused = parseCleanupParams(url(qs), "3652");
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.refusal.error).toContain(String(MIN_SAFE_RETENTION_DAYS));
    }
    expect(parseCleanupParams(url(`?retentionDays=${MIN_SAFE_RETENTION_DAYS}`), "3652").ok).toBe(
      true,
    );
  });

  it("refuses a short summary retention without ?force=1", () => {
    // Summaries are derived and rebuildable, so they get the lighter guard
    // rather than the archive floor.
    const refused = parseCleanupParams(url("?summaryDays=3"), "3652");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.refusal.error).toContain("requires ?force=1");
    expect(parseCleanupParams(url("?summaryDays=3&force=1"), "3652")).toEqual({
      ok: true,
      params: { retentionDays: 3652, summaryDays: 3, force: true, dryRun: false },
    });
  });

  it("reads ?dryRun=1", () => {
    const parsed = parseCleanupParams(url("?dryRun=1"), "3652");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.params.dryRun).toBe(true);
  });

  it("refuses nonsense values", () => {
    expect(parseCleanupParams(url("?retentionDays=abc"), "3652").ok).toBe(false);
    expect(parseCleanupParams(url("?retentionDays=0"), "3652").ok).toBe(false);
    expect(parseCleanupParams(url("?summaryDays=-1"), "3652").ok).toBe(false);
    expect(parseCleanupParams(url(""), "abc").ok).toBe(false);
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
      sightings: [old, old, old, recent],
    });
    const outcome = await runCleanup(store, cutoff, 14, 512, new Date("2026-06-15T00:00:00Z"));
    expect(outcome.deletedEvents).toBe(2);
    expect(outcome.deletedTrips).toBe(1);
    expect(outcome.deletedSummaries).toBe(1);
    expect(outcome.deletedSightings).toBe(3);
    expect(rows.sightings).toEqual([recent]);
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

/**
 * Validated params for a plan under test, defaulting to the live ten-year window.
 * @param over - Fields to override.
 * @returns The params.
 */
function params(over: Partial<CleanupParams> = {}): CleanupParams {
  return { retentionDays: 3652, summaryDays: null, force: false, dryRun: false, ...over };
}

describe("buildCleanupPlan", () => {
  const now = new Date("2026-09-16T00:00:00Z");

  it("reports the share of the archive the run would delete", () => {
    const plan = buildCleanupPlan(params(), { doomedEvents: 240_337, totalEvents: 3_350_000 }, now);
    expect(plan.share).toBeCloseTo(0.0717, 4);
    expect(plan.cutoff).toEqual(cleanupCutoff(3652, now));
  });

  it("reports no share at all on an empty collection", () => {
    expect(buildCleanupPlan(params(), { doomedEvents: 0, totalEvents: 0 }, now).share).toBe(0);
  });
});

describe("checkCleanupPlan", () => {
  const now = new Date("2026-09-16T00:00:00Z");

  /**
   * A plan deleting a share of a million-row archive.
   * @param share - Share of the archive the run would delete.
   * @param retentionDays - Retention window.
   * @returns The plan.
   */
  function planFor(share: number, retentionDays = 3652): ReturnType<typeof buildCleanupPlan> {
    return buildCleanupPlan(
      params({ retentionDays }),
      { doomedEvents: Math.round(1_000_000 * share), totalEvents: 1_000_000 },
      now,
    );
  }

  it("passes a run that deletes a sliver", () => {
    expect(checkCleanupPlan(planFor(MAX_DELETE_SHARE / 2), null, false)).toEqual({ ok: true });
  });

  it("refuses a run over the share ceiling, unless forced", () => {
    const plan = planFor(MAX_DELETE_SHARE * 4);
    const verdict = checkCleanupPlan(plan, null, false);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("share");
    expect(checkCleanupPlan(plan, null, true)).toEqual({ ok: true });
  });

  it("refuses a cutoff that jumps past the last applied one, unless forced", () => {
    const plan = planFor(0);
    const lastCutoff = new Date(plan.cutoff.getTime() - 10 * 86_400_000);
    const verdict = checkCleanupPlan(plan, lastCutoff, false);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("cutoffAdvance");
    expect(checkCleanupPlan(plan, lastCutoff, true)).toEqual({ ok: true });
  });

  it("passes the nightly advance, right up to the ceiling", () => {
    const plan = planFor(0);
    expect(checkCleanupPlan(plan, new Date(plan.cutoff.getTime() - 86_400_000), false)).toEqual({
      ok: true,
    });
    const atLimit = new Date(plan.cutoff.getTime() - MAX_CUTOFF_ADVANCE_DAYS * 86_400_000);
    expect(checkCleanupPlan(plan, atLimit, false)).toEqual({ ok: true });
  });

  it("refuses the 26 September run against a real archive", () => {
    // 14 days against 3.35M rows. parseCleanupParams already refuses this on the
    // retention floor; the share ceiling refuses it a second time, so losing
    // either guard still leaves the archive standing.
    const plan = buildCleanupPlan(
      params({ retentionDays: 14 }),
      { doomedEvents: 240_337, totalEvents: 3_350_000 },
      now,
    );
    expect(checkCleanupPlan(plan, null, false).ok).toBe(false);
  });
});

describe("pickLastAppliedCutoff", () => {
  const applied = { applied: true, cutoff: "2026-09-10T16:00:00.000Z" };
  const older = { applied: true, cutoff: "2026-09-09T16:00:00.000Z" };

  it("takes the newest run that actually deleted", () => {
    expect(pickLastAppliedCutoff([{ detail: applied }, { detail: older }])).toEqual(
      new Date(applied.cutoff),
    );
  });

  it("skips dry runs and refusals, so neither becomes the next night's baseline", () => {
    expect(
      pickLastAppliedCutoff([
        { detail: { applied: false, verdict: "dryRun", cutoff: "2026-09-16T16:00:00.000Z" } },
        { detail: { applied: false, verdict: "refused", cutoff: "2026-09-15T16:00:00.000Z" } },
        { detail: applied },
      ]),
    ).toEqual(new Date(applied.cutoff));
  });

  it("answers null when nothing usable is on record", () => {
    expect(pickLastAppliedCutoff([])).toBeNull();
    expect(pickLastAppliedCutoff([{ detail: null }, { detail: "nonsense" }])).toBeNull();
    expect(pickLastAppliedCutoff([{ detail: { applied: true } }])).toBeNull();
    expect(pickLastAppliedCutoff([{ detail: { applied: true, cutoff: "not a date" } }])).toBeNull();
  });
});
