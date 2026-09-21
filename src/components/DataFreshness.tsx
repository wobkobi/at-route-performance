"use client";
// src/components/DataFreshness.tsx
// Live relative label showing when data was last refreshed and when the next refresh is due,
// and the trigger that re-renders a live page once a newer ingest run lands.

import { viewIncludesToday } from "@/lib/live-view";
import { NZ_TZ, nzServiceDayString } from "@/lib/time";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type JSX } from "react";

/** Props for {@link DataFreshness}. */
export interface DataFreshnessProps {
  /** ISO instant the data was last refreshed (last successful ingest run). */
  lastUpdatedIso: string;
  /** ISO instant the next refresh is expected. */
  nextUpdateIso: string;
  /** Whether the instant is a logged ingest run or the freshest arrival (no run logged yet). */
  source: "run" | "event";
  /** The realtime ingest cadence in seconds; a gap of three cadences reads as stalled. */
  intervalSec: number;
}

/**
 * How often the relative label re-evaluates while the page sits open. The
 * label is worded in minutes past the first one, so a 15s tick keeps it honest
 * without re-rendering the footer every second.
 */
const TICK_MS = 15_000;

/**
 * How often an open tab re-polls `/api/freshness`. Half the two-minute ingest
 * cadence, so a new run is noticed within a minute of landing.
 */
const REFRESH_MS = 60_000;

/** Freshness instants as returned by `/api/freshness`. */
interface FreshnessTimes {
  lastUpdated: string;
  nextUpdate: string;
  source: "run" | "event";
}

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
    timeZone: NZ_TZ,
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
 * projected next-update time (or "due now" once it has passed, and "ingest may
 * be stalled" once three cadences have passed with no run). While no run has
 * been logged at all the line says so rather than projecting a due time from an
 * arrival stamp.
 *
 * The server-rendered instants go stale the moment the ingest cadence laps the
 * page view, so an open tab re-polls `/api/freshness` every {@link REFRESH_MS}
 * and on returning to a hidden tab - otherwise a tab left open reads
 * "update due now" forever while ingest is in fact running. The newest instant
 * wins between the props and the poll, so a client-side navigation with a
 * fresher server render is never downgraded.
 *
 * The same poll keeps the page's own figures live. When it reports a run newer
 * than any this tab has rendered, and the page's window still includes the live
 * day ({@link viewIncludesToday}), it asks the router to re-render the route in
 * place: the numbers update with no reload, and scroll and open panels survive.
 * A past day is left alone, since nothing behind it can move.
 *
 * The relative label and the due-now state depend on the client clock (supplied
 * via {@link useSyncExternalStore}), so they stay absent on the server and first
 * paint and fill in after mount - avoiding any hydration mismatch.
 * @param props - Component props.
 * @param props.lastUpdatedIso - ISO instant the data was last refreshed.
 * @param props.nextUpdateIso - ISO instant the next refresh is expected.
 * @param props.source - Whether the instant is a logged run or the freshest arrival.
 * @param props.intervalSec - The realtime ingest cadence in seconds.
 * @returns The freshness line element.
 */
export function DataFreshness({
  lastUpdatedIso,
  nextUpdateIso,
  source,
  intervalSec,
}: DataFreshnessProps): JSX.Element {
  const nowMs = useSyncExternalStore(subscribeToClock, getClockSnapshot, getServerClockSnapshot);
  const [polled, setPolled] = useState<FreshnessTimes | null>(null);
  const router = useRouter();
  // The newest run a live view in this tab has been rendered from. Advanced only
  // when a live view refreshes, so a run first seen on a past day's page still
  // refreshes today's once the reader steps onto it: that page may be a
  // prefetched or client-cached render from before the run. A ref, since
  // advancing it must not re-render the footer.
  const seenRunRef = useRef(lastUpdatedIso);

  useEffect(() => {
    if (lastUpdatedIso > seenRunRef.current) seenRunRef.current = lastUpdatedIso;
  }, [lastUpdatedIso]);

  useEffect(() => {
    let cancelled = false;
    /** Poll `/api/freshness` and adopt the result, skipping hidden tabs. */
    const refresh = async (): Promise<void> => {
      // Skip hidden tabs; the visibilitychange listener catches up on return.
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/freshness");
        if (!res.ok) return;
        const data = (await res.json()) as Partial<FreshnessTimes>;
        if (!cancelled && data.lastUpdated && data.nextUpdate) {
          setPolled({
            lastUpdated: data.lastUpdated,
            nextUpdate: data.nextUpdate,
            source: data.source === "event" ? "event" : "run",
          });
          // Read the URL now rather than at render: the Routes page rewrites its
          // params on the client without a navigation.
          const params = new URLSearchParams(window.location.search);
          const view = { day: params.get("day"), period: params.get("period") };
          if (
            data.lastUpdated > seenRunRef.current &&
            viewIncludesToday(view, nzServiceDayString())
          ) {
            seenRunRef.current = data.lastUpdated;
            router.refresh();
          }
        }
      } catch {
        // Keep showing the last known instants; the next tick retries.
      }
    };
    const id = setInterval(() => void refresh(), REFRESH_MS);
    /** Catch up immediately when a hidden tab becomes visible again. */
    const onVisible = (): void => {
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  // Newest instant wins (ISO UTC strings compare lexicographically).
  const shown =
    polled && polled.lastUpdated > lastUpdatedIso
      ? {
          lastUpdatedIso: polled.lastUpdated,
          nextUpdateIso: polled.nextUpdate,
          source: polled.source,
        }
      : { lastUpdatedIso, nextUpdateIso, source };

  const lastMs = new Date(shown.lastUpdatedIso).getTime();
  const nextMs = new Date(shown.nextUpdateIso).getTime();
  // Use a live Date.now() so the relative label is never skewed by the bucket
  // floor: if lastMs falls within the current 15-second bucket, nowMs (floored)
  // would be < lastMs and produce "in X seconds" instead of "X seconds ago".
  // eslint-disable-next-line react-hooks/purity
  const currentMs = nowMs === null ? null : Date.now();
  const relative = currentMs === null ? null : formatRelative(lastMs, currentMs);
  const dueNow = currentMs !== null && currentMs >= nextMs;
  const stalledAfterMs = 3 * intervalSec * 1000;
  const stalledMin =
    currentMs !== null && currentMs - lastMs >= stalledAfterMs
      ? Math.round((currentMs - lastMs) / 60_000)
      : null;

  return (
    <p className="text-xs leading-relaxed text-white/70">
      Last updated{" "}
      <time dateTime={shown.lastUpdatedIso} className="font-semibold text-white">
        {nzClock(shown.lastUpdatedIso)}
      </time>
      {relative ? ` (${relative})` : null}
      <span className="px-1.5 text-white/40">&middot;</span>
      {shown.source === "event" ? (
        <span>awaiting the first ingest run</span>
      ) : stalledMin !== null ? (
        <span className="text-at-safety">
          no update for {stalledMin} min, ingest may be stalled
        </span>
      ) : dueNow ? (
        <span className="text-at-safety">update due now</span>
      ) : (
        <>
          next update by{" "}
          <time dateTime={shown.nextUpdateIso} className="font-semibold text-white">
            {nzClock(shown.nextUpdateIso)}
          </time>
        </>
      )}
    </p>
  );
}
