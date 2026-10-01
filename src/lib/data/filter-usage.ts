// src/lib/data/filter-usage.ts
// Which modes ran in a window, so the Mode box only offers a mode that changes
// the figures.

import { TODAY_REVALIDATE } from "@/lib/data/cache";
import { getRankings } from "@/lib/data/rankings";
import { logReadFailure } from "@/lib/db";
import { MODES } from "@/lib/mode";
import type { DateRange } from "@/lib/time/service-day";

/** Which filter choices would change a window's figures. */
export interface FilterUsage {
  /** Modes with at least one route in the window. */
  modes: Set<string>;
}

/**
 * Read a window's filter usage from its route rankings, the cached read the
 * home page and Routes already make, so asking costs no query of its own once
 * either has run.
 *
 * Never rejects: a failed read offers every choice, as the page did before it
 * could tell, rather than failing a header that is streamed separately from
 * the board it sits over.
 * @param range - The window.
 * @returns The modes that ran.
 */
export async function getFilterUsage(range: DateRange): Promise<FilterUsage> {
  try {
    const rows = await getRankings(range, TODAY_REVALIDATE);
    return { modes: new Set(rows.map((r) => r.mode)) };
  } catch (err) {
    logReadFailure("filter-usage", err);
    return { modes: new Set(MODES) };
  }
}
