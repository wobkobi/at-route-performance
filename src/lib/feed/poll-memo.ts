// src/lib/feed/poll-memo.ts
// What the previous realtime poll on this instance wrote, so the next poll can
// skip writes that would change nothing. The upserts are where a poll spends its
// billed Active CPU - about half a millisecond per row - and from one poll to the
// next much of the feed repeats itself: a bus held at a stop, or between stops,
// reports the same prediction again.
//
// The memo is only trusted while this instance ran the newest recorded poll.
// Fluid sends a poll to whichever instance is free, and a poll on another one may
// have written different values since; skipping here would leave those in place.
// A spool replay is the same hazard - it re-issues older writes over the rows -
// so a poll that drained anything starts from an empty memo too.

/** How often a vehicle's register row is rewritten when nothing but `lastSeenAt` would change. */
export const FLEET_REFRESH_MS = 10 * 60_000;

/** What this instance last wrote for one vehicle. */
interface VehicleMark {
  label: string | null;
  plate: string | null;
  writtenAt: number;
}

/** A vehicle as the fleet register takes it. */
interface FleetLike {
  id: string;
  label?: string | null;
  plate?: string | null;
}

/** The writes to make this poll, and how to remember them once they land. */
export interface Picked<T> {
  /** The entries whose write differs from what this instance last sent. */
  changed: T[];
  /** Remember this poll's writes; call only after they landed. */
  commit: () => void;
}

/** One instance's memory of its last poll's writes. */
export class PollMemo {
  /** `startedAt` (ms) of the newest poll this instance recorded, or null. */
  private ownRunStart: number | null = null;

  /** Stop visit key > the write last sent for it. Holds only the last poll's visits. */
  private arrivals = new Map<string, string>();

  /** Vehicle id > what was last written for it. */
  private vehicles = new Map<string, VehicleMark>();

  /** Forget everything, so the next poll writes every row. */
  reset(): void {
    this.ownRunStart = null;
    this.arrivals.clear();
    this.vehicles.clear();
  }

  /**
   * Start a poll: keep the memo only when this instance ran the newest recorded
   * poll and nothing has been replayed over the rows since.
   * @param lastRunStartedAt - `startedAt` of the newest recorded poll, or null when none could be read.
   * @param replayed - Whether this poll drained the spool.
   */
  begin(lastRunStartedAt: Date | null, replayed: boolean): void {
    const owned = lastRunStartedAt !== null && lastRunStartedAt.getTime() === this.ownRunStart;
    if (!owned || replayed) this.reset();
  }

  /**
   * Note that this instance recorded a poll, so the next one here can trust the memo.
   * @param startedAt - The `startedAt` the poll was recorded with.
   */
  recorded(startedAt: Date): void {
    this.ownRunStart = startedAt.getTime();
  }

  /**
   * The stop visits whose write differs from the previous poll's. Committing
   * replaces the memo with this poll's visits alone, so it never outgrows one
   * feed read; a visit that leaves the feed and comes back is written again.
   * @param docs - This poll's visits.
   * @param key - The visit's identity.
   * @param signature - Everything the write sets, as one comparable string.
   * @returns The visits to write, and the commit.
   */
  pickArrivals<T>(docs: T[], key: (doc: T) => string, signature: (doc: T) => string): Picked<T> {
    const next = new Map<string, string>();
    const changed: T[] = [];
    for (const doc of docs) {
      const k = key(doc);
      const sig = signature(doc);
      next.set(k, sig);
      if (this.arrivals.get(k) !== sig) changed.push(doc);
    }
    return {
      changed,
      /** Replace the memo with this poll's visits. */
      commit: () => {
        this.arrivals = next;
      },
    };
  }

  /**
   * The vehicles whose register row needs writing: a new or changed label or
   * plate, or a `lastSeenAt` older than {@link FLEET_REFRESH_MS}. A label the
   * feed left out is not a change, matching the register write, which keeps the
   * stored one.
   * @param fleet - The vehicles in this poll's feed read.
   * @param at - When the read was taken.
   * @returns The vehicles to write, and the commit.
   */
  pickFleet<T extends FleetLike>(fleet: T[], at: Date): Picked<T> {
    const now = at.getTime();
    const changed = fleet.filter((v) => {
      const mark = this.vehicles.get(v.id);
      return (
        !mark ||
        now - mark.writtenAt >= FLEET_REFRESH_MS ||
        (!!v.label && v.label !== mark.label) ||
        (!!v.plate && v.plate !== mark.plate)
      );
    });
    return {
      changed,
      /** Stamp each written vehicle with what its row now holds. */
      commit: () => {
        for (const v of changed) {
          const mark = this.vehicles.get(v.id);
          this.vehicles.set(v.id, {
            label: v.label || (mark?.label ?? null),
            plate: v.plate || (mark?.plate ?? null),
            writtenAt: now,
          });
        }
      },
    };
  }
}

/** The memo the realtime ingest keeps for the life of this instance. */
export const pollMemo = new PollMemo();
