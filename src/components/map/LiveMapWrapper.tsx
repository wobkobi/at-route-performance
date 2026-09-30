"use client";
// src/components/map/LiveMapWrapper.tsx
// Client wrapper that lazy-loads the live network map with a placeholder of the
// same height, as StopMapWrapper does for the route maps, and holds the toggles
// above it for which dots and lines the map draws.

import type { DotBand } from "@/components/map/LiveMap";
import { cn } from "@/lib/cn";
import type { LiveMode } from "@/lib/live-routes";
import dynamic from "next/dynamic";
import { useState, type JSX } from "react";

/**
 * Placeholder while the Leaflet chunk loads; fills the wrapper's height.
 * @returns A pulsing box.
 */
function MapPlaceholder(): JSX.Element {
  return <div className="h-full w-full animate-pulse bg-at-bg motion-reduce:animate-none" />;
}

// ssr: false defers the Leaflet chunk to the client.
const LiveMap = dynamic(() => import("@/components/map/LiveMap"), {
  ssr: false,
  loading: MapPlaceholder,
});

/** The dot toggles, in the order the key reads, each with its dot's colour. */
const DOT_TOGGLES: ReadonlyArray<{ band: DotBand; label: string; dot: string }> = [
  { band: "late", label: "Late", dot: "bg-at-late" },
  { band: "ontime", label: "On time", dot: "bg-at-ontime" },
  { band: "early", label: "Early", dot: "bg-at-early-strong" },
  { band: "unknown", label: "No delay", dot: "bg-at-muted" },
];

/** A toggle's classes: the site's chip, filled while its layer is on the map. */
const TOGGLE = "chip gap-1.5 border";
const TOGGLE_ON = "border-at-ink bg-at-surface text-at-ink";
const TOGGLE_OFF =
  "border-at-border bg-at-surface text-at-muted line-through decoration-at-muted hover:border-at-shore";

/**
 * The live map, sized by its wrapper so the placeholder and the map match, with
 * a row of toggles above it. The toggles double as the dots' colour key: each
 * shows or hides one delay band's dots, so the late vehicles can be picked out
 * of a peak's thousand, and a last one hides the route lines under them. They
 * are view settings for this visit, not filters, so they stay out of the URL.
 *
 * "All vehicles" is the master switch: with every band on it hides them all,
 * otherwise it turns them all on. Vehicles on a trip with no history stored
 * (every MEX trip, say) never draw, since the pages they link to are empty; a
 * trip's vehicle shows once its first arrival lands.
 * @param props - Component props.
 * @param props.mode - Show one mode's vehicles, or null for every mode.
 * @param props.className - Height classes for the map's box.
 * @returns The toggles and the sized map.
 */
export default function LiveMapWrapper({
  mode,
  className,
}: {
  mode: LiveMode | null;
  className?: string;
}): JSX.Element {
  const [bands, setBands] = useState<ReadonlySet<DotBand>>(
    () => new Set(DOT_TOGGLES.map((t) => t.band)),
  );
  const [lines, setLines] = useState(true);
  const everything = bands.size === DOT_TOGGLES.length;

  /**
   * Show or hide one band's dots.
   * @param band - The band.
   */
  const toggle = (band: DotBand): void => {
    setBands((prev) => {
      const next = new Set(prev);
      if (next.has(band)) next.delete(band);
      else next.add(band);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      <div role="group" aria-label="Show on the map" className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={everything}
          onClick={() => setBands(new Set(everything ? [] : DOT_TOGGLES.map((t) => t.band)))}
          className={cn(TOGGLE, everything ? TOGGLE_ON : TOGGLE_OFF)}
        >
          All vehicles
        </button>
        <span aria-hidden className="mx-1 hidden h-5 w-px bg-at-border sm:inline-block" />
        {DOT_TOGGLES.map((t) => {
          const on = bands.has(t.band);
          return (
            <button
              key={t.band}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(t.band)}
              className={cn(TOGGLE, on ? TOGGLE_ON : TOGGLE_OFF)}
            >
              <span
                aria-hidden
                className={cn("inline-block h-2.5 w-2.5 rounded-full", t.dot, !on && "opacity-30")}
              />
              {t.label}
            </button>
          );
        })}
        {/* Hidden on phones, where the row wraps and it would lead the second line. */}
        <span aria-hidden className="mx-1 hidden h-5 w-px bg-at-border sm:inline-block" />
        <button
          type="button"
          aria-pressed={lines}
          onClick={() => setLines((v) => !v)}
          className={cn(TOGGLE, lines ? TOGGLE_ON : TOGGLE_OFF)}
        >
          <span
            aria-hidden
            className={cn("inline-block h-0.5 w-3.5 bg-at-shore", !lines && "opacity-30")}
          />
          Route lines
        </button>
      </div>
      <div className={className}>
        <LiveMap mode={mode} bands={bands} showLines={lines} className="h-full w-full" />
      </div>
    </div>
  );
}
