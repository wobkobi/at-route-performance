// src/components/shame/ShameWorstBadge.tsx
/**
 * @description Small "Worst" pill shown beside a shame board's crowned row.
 */
import type { JSX } from "react";

/**
 * The small "Worst" pill shown beside a shame board's crowned row.
 * @returns The badge element.
 */
export function ShameWorstBadge(): JSX.Element {
  return (
    <span className="bg-at-late px-1.5 py-0.5 text-[10px] font-bold tracking-zero text-white uppercase">
      Worst
    </span>
  );
}
