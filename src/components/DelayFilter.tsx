import { cn } from "@/lib/cn";
import type { DelayDirection } from "@/lib/rankings";
import type { JSX } from "react";

/** Props for {@link DelayFilter}. */
export interface DelayFilterProps {
  /** Currently active direction, or null for "All". */
  active: DelayDirection;
  /** Page path the chips link to. */
  basePath: string;
  /** Query params to preserve on the links (the `dir` param is set here). */
  preservedParams: Record<string, string>;
}

const DIRS: { key: "" | "late" | "early"; label: string; activeClass: string }[] = [
  { key: "", label: "All", activeClass: "bg-at-shore text-white" },
  { key: "late", label: "Late", activeClass: "bg-at-late text-white" },
  { key: "early", label: "Early", activeClass: "bg-at-early text-at-ink" },
];

/**
 * Render All/Late/Early chips that filter the "most off-schedule" board by the
 * direction a route runs off schedule.
 * @param props - Component props.
 * @param props.active - The active direction, or null for "All".
 * @param props.basePath - Page path the chips link to.
 * @param props.preservedParams - Query params to keep when switching direction.
 * @returns The filter chips element.
 */
export function DelayFilter({ active, basePath, preservedParams }: DelayFilterProps): JSX.Element {
  return (
    <div className={cn("flex flex-wrap gap-2")}>
      {DIRS.map((d) => {
        const params = new URLSearchParams({
          ...preservedParams,
          ...(d.key ? { dir: d.key } : {}),
        });
        const href = params.toString() ? `${basePath}?${params.toString()}` : basePath;
        const isActive = (active ?? "") === d.key;
        return (
          <a
            key={d.key || "all"}
            href={href}
            className={cn(
              "rounded-full px-3 py-1 text-sm font-semibold",
              isActive ? d.activeClass : "bg-at-surface text-at-ink",
            )}
          >
            {d.label}
          </a>
        );
      })}
    </div>
  );
}
