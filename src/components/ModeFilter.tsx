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
}

const MODES: { key: "" | "BUS" | "TRAIN" | "FERRY"; label: string }[] = [
  { key: "", label: "All" },
  { key: "BUS", label: "Bus" },
  { key: "TRAIN", label: "Train" },
  { key: "FERRY", label: "Ferry" },
];

/**
 * Render Bus/Train/Ferry filter chips that narrow the route lists by mode.
 * @param props - Component props.
 * @param props.active - The active mode, or null for "All".
 * @param props.basePath - Page path the chips link to.
 * @param props.preservedParams - Query params to keep when switching mode.
 * @returns The filter chips element.
 */
export function ModeFilter({ active, basePath, preservedParams }: ModeFilterProps): JSX.Element {
  return (
    <div className={cn("flex flex-wrap gap-2")}>
      {MODES.map((m) => {
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
            className={cn(
              "rounded-full px-3 py-1 text-sm font-semibold",
              isActive ? "bg-at-shore text-white" : "bg-at-surface text-at-ink",
            )}
          >
            {m.label}
          </a>
        );
      })}
    </div>
  );
}
