import { cn } from "@/lib/cn";
import type { JSX } from "react";

/** Props for {@link WindowControls}. */
export interface WindowControlsProps {
  /** Active window. */
  window: "week" | "month";
  /** Label of the period being shown (e.g. "2026-W25" or "June 2026"). */
  periodLabel: string;
}

/**
 * Render the Week/Month toggle and current period label.
 * @param props - Component props.
 * @param props.window - Active window.
 * @param props.periodLabel - Human label for the active period.
 * @returns The controls element.
 */
export function WindowControls({ window, periodLabel }: WindowControlsProps): JSX.Element {
  const tabs: { key: "week" | "month"; label: string }[] = [
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
  ];
  return (
    <div className={cn("flex items-center gap-3")}>
      <div className={cn("flex gap-2")}>
        {tabs.map((t) => (
          <a
            key={t.key}
            href={`/rankings?window=${t.key}`}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-semibold",
              window === t.key ? "bg-at-shore text-white" : "bg-at-surface text-at-ink",
            )}
          >
            {t.label}
          </a>
        ))}
      </div>
      <span className={cn("text-sm text-at-muted")}>{periodLabel}</span>
    </div>
  );
}
