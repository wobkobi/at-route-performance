// src/components/BadgeKey.tsx
// Key under a board, naming each badge its rows can carry and what it means.

import { cn } from "@/lib/cn";
import type { JSX } from "react";

/** One entry in a board's badge key. */
export interface BadgeKeyItem {
  /** The badge text, matching the row exactly. */
  label: string;
  /** The narrower label a row shows below `sm`; omit when the label does not change. */
  shortLabel?: string;
  /** Tailwind colour classes for the badge; omit for a marker the rows render as plain text. */
  className?: string;
  /** What the badge means, in a phrase. */
  meaning: string;
}

/**
 * Key for the badges a board's rows carry. Badge meanings used to live only in a
 * `title`, which a phone cannot reach at all - and a phone is where the rows
 * carry the shorter of the two labels, so it had the least to go on and the
 * least way to ask. Callers pass only the badges their rows actually show, so
 * the key never describes a badge that is not on screen.
 * @param props - Component props.
 * @param props.items - The badges present in the rows.
 * @returns The key, or null when the rows carry no badges.
 */
export function BadgeKey({ items }: { items: BadgeKeyItem[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-at-muted">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-1.5">
          <dt
            className={cn(
              "shrink-0 font-bold",
              i.className ? cn("rounded px-1.5 py-0.5", i.className) : "text-at-late",
            )}
          >
            {i.shortLabel && i.shortLabel !== i.label ? (
              <>
                <span className="sm:hidden">{i.shortLabel}</span>
                <span className="hidden sm:inline">{i.label}</span>
              </>
            ) : (
              i.label
            )}
          </dt>
          <dd>{i.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}
