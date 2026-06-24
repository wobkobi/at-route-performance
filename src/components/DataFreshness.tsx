"use client";

import { useSyncExternalStore, type JSX } from "react";

/** Props for {@link DataFreshness}. */
export interface DataFreshnessProps {
  /** ISO instant the data was last refreshed (last successful ingest run). */
  lastUpdatedIso: string;
  /** ISO instant the next refresh is expected. */
  nextUpdateIso: string;
}

/** How often the relative label re-evaluates while the page sits open. */
const TICK_MS = 1_000;

/**
 * Subscribe a re-render to a periodic clock tick.
 * @param onChange - Callback React passes to request a re-read of the snapshot.
 * @returns An unsubscribe function that stops the tick.
 */
function subscribeToClock(onChange: () => void): () => void {
  const id = setInterval(onChange, TICK_MS);
  return () => clearInterval(id);
}

/**
 * Current time bucketed to the tick window, so the snapshot stays referentially
 * stable between ticks (a fresh `Date.now()` every read would loop forever).
 * @returns Epoch ms truncated to the tick window.
 */
function getClockSnapshot(): number | null {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}

/**
 * Server snapshot: there is no client clock yet, so the relative label is absent
 * on the server and first paint (keeping SSR and hydration in agreement).
 * @returns Always null.
 */
function getServerClockSnapshot(): number | null {
  return null;
}

/**
 * Format an instant as Auckland-local HH:MM (24h), stable across server/client.
 * @param iso - ISO instant string.
 * @returns The Auckland-local clock time, e.g. `08:24`.
 */
function nzClock(iso: string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * Render `fromMs` relative to `nowMs` ("2 minutes ago", "in 1 minute", "now"),
 * picking the coarsest sensible unit. Negative diffs are in the past.
 * @param fromMs - The instant being described, in epoch ms.
 * @param nowMs - The reference "now", in epoch ms.
 * @returns A localised relative-time phrase.
 */
function formatRelative(fromMs: number, nowMs: number): string {
  const rtf = new Intl.RelativeTimeFormat("en-NZ", { numeric: "auto" });
  const diffSec = Math.round((fromMs - nowMs) / 1000);
  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");
  return rtf.format(Math.round(diffHr / 24), "day");
}

/**
 * Footer freshness line: the absolute Auckland-local time the data was last
 * updated, a live relative label that ticks as the page sits open, and the
 * projected next-update time (or "due now" once it has passed - the page is
 * served from a short ISR cache, so the moment can already be behind us).
 *
 * The relative label and the due-now state depend on the client clock (supplied
 * via {@link useSyncExternalStore}), so they stay absent on the server and first
 * paint and fill in after mount - avoiding any hydration mismatch.
 * @param props - Component props.
 * @param props.lastUpdatedIso - ISO instant the data was last refreshed.
 * @param props.nextUpdateIso - ISO instant the next refresh is expected.
 * @returns The freshness line element.
 */
export function DataFreshness({ lastUpdatedIso, nextUpdateIso }: DataFreshnessProps): JSX.Element {
  const nowMs = useSyncExternalStore(subscribeToClock, getClockSnapshot, getServerClockSnapshot);

  const lastMs = new Date(lastUpdatedIso).getTime();
  const nextMs = new Date(nextUpdateIso).getTime();
  // Use a live Date.now() so the relative label is never skewed by the bucket
  // floor: if lastMs falls within the current 15-second bucket, nowMs (floored)
  // would be < lastMs and produce "in X seconds" instead of "X seconds ago".
  // eslint-disable-next-line react-hooks/purity
  const currentMs = nowMs === null ? null : Date.now();
  const relative = currentMs === null ? null : formatRelative(lastMs, currentMs);
  const dueNow = currentMs !== null && currentMs >= nextMs;

  return (
    <p className="text-xs leading-relaxed text-white/70">
      Last updated{" "}
      <time dateTime={lastUpdatedIso} className="font-semibold text-white">
        {nzClock(lastUpdatedIso)}
      </time>
      {relative ? ` (${relative})` : null}
      <span className="px-1.5 text-white/40">&middot;</span>
      {dueNow ? (
        <span className="text-at-safety">update due now</span>
      ) : (
        <>
          next update by{" "}
          <time dateTime={nextUpdateIso} className="font-semibold text-white">
            {nzClock(nextUpdateIso)}
          </time>
        </>
      )}
    </p>
  );
}
