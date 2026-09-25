// src/lib/stop-grain.ts
// What a stop page stands for, in the words AT itself uses. A page is one pole of
// a road or one pier, or it is every pole of an interchange averaged together, and
// until this the eyebrow said "Stop" for all of them - so a reader at Manukau's 23
// bays and a reader at one bus pole were told the same thing about figures that
// mean different things.

import { platformNoun } from "@/lib/station-platforms";

/** The generic word for one pole of each mode, for a place whose labels carry none. */
const MODE_WORD: Record<string, string> = { BUS: "stop", TRAIN: "platform", FERRY: "pier" };

/** How each mode is named in the eyebrow. */
const MODE_LABEL: Record<string, string> = { BUS: "bus", TRAIN: "train", FERRY: "ferry" };

/**
 * The mode a stop's arrivals were mostly made by, weighted by arrivals rather than
 * by row count: a station's one bus route calling twice does not outvote its
 * trains. Null when nothing arrived, which is the only honest answer - a stop's own
 * record carries no mode, so a day with no arrivals leaves the page nothing to
 * read a mode from.
 * @param routes - The stop's per-route rows for the window.
 * @returns The mode, or null when there is no arrival to judge from.
 */
export function dominantStopMode(
  routes: readonly { mode: string; events: number }[],
): string | null {
  const totals = new Map<string, number>();
  for (const r of routes) totals.set(r.mode, (totals.get(r.mode) ?? 0) + r.events);
  let best: string | null = null;
  let most = -1;
  for (const [mode, events] of totals) {
    if (events > most) {
      best = mode;
      most = events;
    }
  }
  return best;
}

/**
 * The eyebrow above a stop's name: what the figures below it cover. A single pole
 * names its mode ("Bus stop"), and a place that groups several says how many, so
 * "23 bus bays" above Manukau Bus Station tells a reader its one on-time figure is
 * an average of 23 of them.
 *
 * The noun comes from {@link platformNoun}, so the eyebrow and the per-platform
 * table beneath it call a pole the same thing. **No facility word is invented**: a
 * grouped page does not become a "station" or an "interchange" here, because AT's
 * own name for the place already says which of those it is - or deliberately says
 * neither, as at "Onehunga".
 * @param mode - The stop's dominant mode, or null when nothing arrived.
 * @param labels - AT's label for each pole, empty for a stop that has no platforms.
 * @param poleCount - How many GTFS stops the page stands for.
 * @returns The eyebrow text.
 */
export function stopGrain(
  mode: string | null,
  labels: readonly string[],
  poleCount: number,
): string {
  // A page with platforms takes the same noun its per-platform table would use,
  // down to that table's own "platform" generic, so one screen never calls a pole
  // two things. Only a lone pole, which has no platforms and so no table, falls
  // back to the mode's word.
  const noun =
    labels.length > 0
      ? platformNoun(labels.map((label) => ({ label })))
      : mode === null
        ? "stop"
        : (MODE_WORD[mode] ?? "stop");
  const modeLabel = mode === null ? null : (MODE_LABEL[mode] ?? null);
  if (poleCount > 1) {
    return `${poleCount} ${modeLabel === null ? "" : `${modeLabel} `}${noun}s`;
  }
  const one = modeLabel === null ? noun : `${modeLabel} ${noun}`;
  return one.charAt(0).toUpperCase() + one.slice(1);
}
