import { cn } from "@/lib/cn";
import type { JSX } from "react";

/** A transport mode, or null for "All". */
export type ModeFilterValue = "BUS" | "TRAIN" | "FERRY" | null;

/** Props for {@link ModeFilter}. */
export interface ModeFilterProps {
  /** Currently active mode, or null for "All". */
  active: ModeFilterValue;
  /** Page path the chips link to. */
  basePath: string;
  /** Query params to preserve on the links (the `mode` param is set here). */
  preservedParams: Record<string, string>;
  /**
   * Set of mode keys that have qualifying data for the current period. When
   * provided, chips for modes not in the set are hidden rather than shown as
   * dead ends. "All" is always shown.
   */
  availableModes?: Set<string>;
}

const MODES: { key: "" | "BUS" | "TRAIN" | "FERRY"; label: string }[] = [
  { key: "", label: "All" },
  { key: "BUS", label: "Bus" },
  { key: "TRAIN", label: "Train" },
  { key: "FERRY", label: "Ferry" },
];

/**
 * Render Bus/Train/Ferry filter chips that narrow the route lists by mode.
 * When `availableModes` is provided, chips for modes with no qualifying data
 * are hidden to prevent dead-end navigations.
 * @param props - Component props.
 * @param props.active - The active mode, or null for "All".
 * @param props.basePath - Page path the chips link to.
 * @param props.preservedParams - Query params to keep when switching mode.
 * @param props.availableModes - Modes with qualifying data (optional).
 * @returns The filter chips element.
 */
export function ModeFilter({
  active,
  basePath,
  preservedParams,
  availableModes,
}: ModeFilterProps): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {MODES.map((m) => {
        // Hide non-All chips when that mode has no qualifying data.
        if (m.key && availableModes && !availableModes.has(m.key)) return null;
        const params = new URLSearchParams({
          ...preservedParams,
          ...(m.key ? { mode: m.key } : {}),
        });
        const href = params.toString() ? `${basePath}?${params.toString()}` : basePath;
        const isActive = (active ?? "") === m.key;
        return (
          <a
            key={m.key || "all"}
            href={href}
            className={cn("chip", isActive ? "chip-on" : "chip-off")}
          >
            {m.label}
          </a>
        );
      })}
    </div>
  );
}
