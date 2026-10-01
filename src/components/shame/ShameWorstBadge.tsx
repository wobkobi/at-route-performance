// src/components/shame/ShameWorstBadge.tsx
// Small "Worst" badge shown beside a shame board's crowned row.

import { Badge } from "@/components/ui/Badge";
import type { JSX } from "react";

/**
 * The small "Worst" badge shown beside a shame board's crowned row.
 * @returns The badge element.
 */
export function ShameWorstBadge(): JSX.Element {
  return <Badge tone="late" label="WORST" />;
}
