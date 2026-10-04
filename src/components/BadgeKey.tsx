// src/components/BadgeKey.tsx
// Key under a board, naming each badge its rows can carry and what it means.

import { BadgeLabel, badgeClass, type BadgeTone } from "@/components/ui/Badge";
import { SwatchKey } from "@/components/ui/SwatchKey";
import type { JSX } from "react";

/** One entry in a board's badge key. */
export interface BadgeKeyItem {
  /** The badge text, matching the row exactly. */
  label: string;
  /** The narrower label a row shows below `sm`; omit when the label does not change. */
  shortLabel?: string;
  /** The badge's tone; omit for a marker the rows render as plain red text. */
  tone?: BadgeTone;
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
  return (
    <SwatchKey
      className="mt-3"
      items={items.map((i) => ({
        key: i.label,
        swatch: (
          <span className={i.tone ? badgeClass(i.tone) : "font-bold text-at-late"}>
            <BadgeLabel label={i.label} shortLabel={i.shortLabel} />
          </span>
        ),
        label: i.meaning,
      }))}
    />
  );
}
