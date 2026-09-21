// src/components/MapLegend.tsx
// The keys for the route and trip maps: stop dot colours beside the heading, and
// under the map what a live vehicle marker and an off-route line mean.
import type { JSX } from "react";

/**
 * The three stop-dot colours, for the map section's heading row.
 * @returns The key.
 */
export function StopDotKey(): JSX.Element {
  return (
    <span className="flex items-center gap-3 text-xs text-at-muted">
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-at-late" /> late
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-at-early" /> early
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-at-ontime" /> on time
      </span>
    </span>
  );
}

/**
 * What the map's other marks mean, under the map. The vehicle entry draws a small
 * copy of the marker (ring and heading chevron) so the words point at something
 * the reader can match; it must follow the marker drawn in StopMap.
 * @param props - Component props.
 * @param props.live - The map shows live vehicles.
 * @param props.offRoute - The map draws off-route readings.
 * @returns The key, or null when the map has neither.
 */
export function MapMarkKey({
  live,
  offRoute = false,
}: {
  live: boolean;
  offRoute?: boolean;
}): JSX.Element | null {
  if (!live && !offRoute) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs text-at-muted">
      {live && (
        <li className="flex items-start gap-2">
          <svg viewBox="0 0 40 40" className="-mt-1 h-8 w-8 shrink-0" aria-hidden="true">
            <circle
              cx="20"
              cy="20"
              r="14"
              className="fill-at-surface stroke-at-late"
              strokeWidth="3"
            />
            <path
              d="M20 0.75 L27.5 10 L20 7 L12.5 10 Z"
              transform="rotate(45 20 20)"
              className="fill-at-late stroke-at-surface"
              strokeWidth="1.5"
              strokeLinejoin="round"
              paintOrder="stroke"
            />
          </svg>
          <span>
            A vehicle on the route now, ringed in its delay colour (grey when the feed gives no
            delay). The point shows which way it is heading, and a label beside it says how far off
            schedule it is once it is outside the on-time window.
          </span>
        </li>
      )}
      {offRoute && (
        <li className="flex items-start gap-2">
          <span
            className="mt-2 inline-block w-4 shrink-0 border-t-2 border-dashed border-at-commercial"
            aria-hidden="true"
          />
          <span>Where the vehicle was seen off its route.</span>
        </li>
      )}
    </ul>
  );
}
