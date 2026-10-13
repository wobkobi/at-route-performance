// tests/lib/feed/poll-memo.test.ts
// Unit tests for the poll memo: which writes it lets a poll skip, when it stops
// trusting itself, and that nothing is remembered until a write has landed.
import { FLEET_REFRESH_MS, PollMemo } from "@/lib/feed/poll-memo";
import { describe, expect, it } from "vitest";

interface Visit {
  id: string;
  value: number;
}

/**
 * A visit's identity.
 * @param v - The visit.
 * @returns Its id.
 */
const key = (v: Visit): string => v.id;
/**
 * A visit's write.
 * @param v - The visit.
 * @returns Its value as a string.
 */
const sig = (v: Visit): string => String(v.value);

const RUN_1 = new Date("2026-10-14T00:00:00Z");
const RUN_2 = new Date("2026-10-14T00:02:00Z");

/**
 * A memo that has written these visits on a recorded poll.
 * @param visits - What the poll wrote.
 * @returns The memo, with RUN_1 as its own recorded poll.
 */
function memoAfter(visits: Visit[]): PollMemo {
  const memo = new PollMemo();
  memo.begin(null, false);
  memo.pickArrivals(visits, key, sig).commit();
  memo.recorded(RUN_1);
  return memo;
}

describe("PollMemo arrivals", () => {
  it("writes everything on a fresh instance", () => {
    const memo = new PollMemo();
    memo.begin(RUN_1, false);
    const visits = [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ];
    expect(memo.pickArrivals(visits, key, sig).changed).toEqual(visits);
  });

  it("skips a visit whose write has not moved since its own last poll", () => {
    const memo = memoAfter([
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ]);
    memo.begin(RUN_1, false);
    const picked = memo.pickArrivals(
      [
        { id: "a", value: 1 },
        { id: "b", value: 3 },
        { id: "c", value: 4 },
      ],
      key,
      sig,
    );
    expect(picked.changed.map((v) => v.id)).toEqual(["b", "c"]);
  });

  it("forgets everything when another instance ran the newest poll", () => {
    const memo = memoAfter([{ id: "a", value: 1 }]);
    memo.begin(RUN_2, false);
    expect(memo.pickArrivals([{ id: "a", value: 1 }], key, sig).changed).toHaveLength(1);
  });

  it("forgets everything when the newest poll could not be read", () => {
    const memo = memoAfter([{ id: "a", value: 1 }]);
    memo.begin(null, false);
    expect(memo.pickArrivals([{ id: "a", value: 1 }], key, sig).changed).toHaveLength(1);
  });

  it("forgets everything after a spool drain, which may have overwritten rows", () => {
    const memo = memoAfter([{ id: "a", value: 1 }]);
    memo.begin(RUN_1, true);
    expect(memo.pickArrivals([{ id: "a", value: 1 }], key, sig).changed).toHaveLength(1);
  });

  it("remembers nothing from a pick that was never committed", () => {
    const memo = memoAfter([{ id: "a", value: 1 }]);
    memo.begin(RUN_1, false);
    memo.pickArrivals([{ id: "a", value: 2 }], key, sig);
    // The value-2 write never landed, so the row still holds 1 and 1 is skipped.
    expect(memo.pickArrivals([{ id: "a", value: 1 }], key, sig).changed).toHaveLength(0);
  });

  it("drops visits that left the feed, so one that returns is written again", () => {
    const memo = memoAfter([{ id: "a", value: 1 }]);
    memo.begin(RUN_1, false);
    memo.pickArrivals([{ id: "b", value: 2 }], key, sig).commit();
    memo.recorded(RUN_2);
    memo.begin(RUN_2, false);
    expect(memo.pickArrivals([{ id: "a", value: 1 }], key, sig).changed).toHaveLength(1);
  });
});

describe("PollMemo fleet", () => {
  const T0 = new Date("2026-10-14T00:00:00Z");
  /**
   * An instant after T0.
   * @param ms - How long after.
   * @returns The instant.
   */
  const later = (ms: number): Date => new Date(T0.getTime() + ms);

  /**
   * A memo that has written one vehicle at T0.
   * @returns The memo.
   */
  function withBus(): PollMemo {
    const memo = new PollMemo();
    memo.begin(null, false);
    memo.pickFleet([{ id: "v1", label: "NB1", plate: "ABC" }], T0).commit();
    memo.recorded(RUN_1);
    memo.begin(RUN_1, false);
    return memo;
  }

  it("skips an unchanged vehicle inside the refresh window", () => {
    const picked = withBus().pickFleet([{ id: "v1", label: "NB1", plate: "ABC" }], later(60_000));
    expect(picked.changed).toHaveLength(0);
  });

  it("rewrites an unchanged vehicle once the refresh window has passed", () => {
    const picked = withBus().pickFleet(
      [{ id: "v1", label: "NB1", plate: "ABC" }],
      later(FLEET_REFRESH_MS),
    );
    expect(picked.changed).toHaveLength(1);
  });

  it("writes a changed label at once", () => {
    const picked = withBus().pickFleet([{ id: "v1", label: "NB2", plate: "ABC" }], later(60_000));
    expect(picked.changed).toHaveLength(1);
  });

  it("does not count a label the feed left out as a change", () => {
    const picked = withBus().pickFleet([{ id: "v1", label: null, plate: null }], later(60_000));
    expect(picked.changed).toHaveLength(0);
  });

  it("keeps the stored label when a write without one lands", () => {
    const memo = withBus();
    memo.pickFleet([{ id: "v1", label: null, plate: null }], later(FLEET_REFRESH_MS)).commit();
    const picked = memo.pickFleet(
      [{ id: "v1", label: "NB1", plate: "ABC" }],
      later(FLEET_REFRESH_MS + 60_000),
    );
    expect(picked.changed).toHaveLength(0);
  });
});
