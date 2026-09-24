// src/lib/departure-label.ts
// Turn AT's two headsigns into what a departures board needs: where a service is
// going from this stop, and the road or station it goes by.

import { normaliseHeadsign } from "@/lib/station";

/** Where a departure is bound, split for a board's two lines. */
export interface DepartureLabel {
  /** Where the service is going, or null when AT named neither headsign. */
  destination: string | null;
  /** The road or station it goes by, without the word "via". */
  via: string | null;
}

/**
 * The first standalone "to" and "via", in whatever case AT wrote them: casing is
 * mixed inside one stop ("New Lynn To City Centre" beside "New Lynn to Ranui").
 */
const TO_RE = /\bto\b/i;
const VIA_RE = /\bvia\b/i;

/**
 * Undo a headsign AT shouted, leaving one already written plainly alone
 * ("BRITOMART" > "Britomart"; "Manukau via City Centre" unchanged). Buses shout
 * their per-stop headsigns; trains and ferries do not.
 * @param text - The headsign or fragment.
 * @returns The text with only its initials capitalised, if it was all capitals.
 */
function unshout(text: string): string {
  if (text !== text.toUpperCase()) return text;
  return text.replace(/\p{L}[\p{L}'’]*/gu, (word) => word.charAt(0) + word.slice(1).toLowerCase());
}

/**
 * The part of a headsign after its first match, trimmed.
 * @param text - The headsign.
 * @param re - The word to cut at.
 * @returns The remainder, or null when the word is absent.
 */
function after(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m === null ? null : text.slice(m.index + m[0].length).trim();
}

/**
 * Split a trip headsign into what a rider needs on a departures board. AT writes
 * "<origin> To <destination> Via <road>" with inconsistent casing and never more
 * than one " to " in a headsign, so the first one separates the origin - which a
 * rider standing at this stop does not need - from the rest.
 *
 * A train's headsign carries platform numbers its stop headsign does not
 * ("Henderson 1 To Manukau 1 Via Waitemata 1"), so {@link normaliseHeadsign}
 * runs first for that mode. Loop and Link services carry no origin at all
 * ("Freemans Bay Loop"), and for those AT's per-stop headsign is the only
 * statement of where the service goes from here - measured at Freemans Bay
 * School, where all 37 departures read "Freemans Bay Loop" against a stop
 * headsign of "BRITOMART".
 * @param tripHeadsign - The trip's own headsign, or null.
 * @param stopHeadsign - The headsign AT publishes for this stop, or null.
 * @param mode - The route's mode, which decides whether platform numbers go.
 * @returns The destination and the via, either of which may be null.
 */
export function departureLabel(
  tripHeadsign: string | null,
  stopHeadsign: string | null,
  mode: "BUS" | "TRAIN" | "FERRY",
): DepartureLabel {
  const trip = mode === "TRAIN" ? normaliseHeadsign(tripHeadsign) : tripHeadsign;
  const bound = trip === null ? null : after(trip, TO_RE);

  if (bound === null) {
    const fallback = (stopHeadsign ?? trip ?? "").trim();
    return { destination: fallback === "" ? null : unshout(fallback), via: null };
  }

  const viaAt = VIA_RE.exec(bound);
  const destination = (viaAt === null ? bound : bound.slice(0, viaAt.index)).trim();
  const via = viaAt === null ? "" : bound.slice(viaAt.index + viaAt[0].length).trim();
  return {
    destination: destination === "" ? null : unshout(destination),
    via: via === "" ? null : unshout(via),
  };
}
