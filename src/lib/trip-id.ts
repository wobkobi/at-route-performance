// src/lib/trip-id.ts
// Reading a run's scheduled start out of AT's own identifiers: the GTFS
// `HH:MM:SS` start time the feed sends, and the start seconds encoded in the
// trip id when it does not. Kept apart from the board modules so the ingest and
// migration paths can take it without pulling a board's imports in behind it.

/** GTFS `HH:MM:SS`; hours run past 23 for post-midnight trips. */
const GTFS_TIME_RE = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/;

/** Latest start a GTFS time can sensibly carry (48h covers any extended time). */
const MAX_GTFS_SEC = 48 * 3600;

/**
 * Seconds past the GTFS reference for a `HH:MM:SS` schedule time.
 * @param hms - GTFS time string, e.g. "07:30:00" or "24:15:00".
 * @returns The seconds, or null when the string is missing or malformed.
 */
export function gtfsTimeSeconds(hms: string | null | undefined): number | null {
  const m = hms ? GTFS_TIME_RE.exec(hms) : null;
  if (!m) return null;
  const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return sec < MAX_GTFS_SEC ? sec : null;
}

/**
 * Start seconds encoded in an AT trip id. AT ids read
 * `{block}-{service}-{startSeconds}-{variant}-{hash}` (e.g.
 * "1060-14804-82800-2-efb6f52a" starts at 23:00:00), with a sixth segment on
 * some. A fallback for a run with no captured `start_time`.
 * @param tripId - AT GTFS trip id.
 * @returns The start in seconds past the GTFS reference, or null when the id has another shape.
 */
export function tripIdStartSeconds(tripId: string): number | null {
  const seg = tripId.split("-")[2];
  if (!seg || !/^\d+$/.test(seg)) return null;
  const sec = Number(seg);
  return sec < MAX_GTFS_SEC ? sec : null;
}

/**
 * The block-and-service prefix of an AT trip id, with its trailing separator, so
 * an id range from the prefix to the prefix plus `￿` bounds every trip of
 * one block on one service pattern. Every other slot of the run's own block
 * shares it.
 * @param tripId - AT GTFS trip id.
 * @returns The prefix, or null when the id carries fewer than two segments.
 */
export function tripIdPrefix(tripId: string): string | null {
  const parts = tripId.split("-");
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return `${parts[0]}-${parts[1]}-`;
}

/**
 * The variant hash of an AT trip id: its last segment, on both the usual
 * five-segment form and the six-segment train form. Two slots sharing a prefix
 * and a start second can still be different timetable patterns, and only the
 * hash tells them apart - four ids share start 81900 under prefix `1108-15203`,
 * and only one of them belongs to the pattern that ran on 14 September 2026.
 * @param tripId - AT GTFS trip id.
 * @returns The hash, or null when the id carries no separator.
 */
export function tripIdVariantHash(tripId: string): string | null {
  const parts = tripId.split("-");
  return parts.length < 2 ? null : (parts.at(-1) ?? null);
}
