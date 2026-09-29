// src/components/RankingFiltersNote.tsx
// The line under the home verdict naming the narrowing filters, so a figure
// read with the filter boxes out of sight still says what it covers.

import { AREAS } from "@/lib/areas";
import { rankingFiltersPhrase, type RankingFilters } from "@/lib/ranking-filters";
import type { JSX } from "react";

/**
 * What the filters cover and what they leave whole. Renders nothing with no
 * filter set.
 * @param props - Component props.
 * @param props.filters - The active filters.
 * @param props.window - The window shown, for naming what the unfiltered parts cover.
 * @param props.live - Whether the window is the day still under way.
 * @returns The note, or null.
 */
export function RankingFiltersNote({
  filters,
  window,
  live,
}: {
  filters: RankingFilters;
  window: "day" | "week" | "month";
  live: boolean;
}): JSX.Element | null {
  const phrase = rankingFiltersPhrase(
    filters,
    AREAS.filter((a) => filters.areas.includes(a.key)).map((a) => a.label),
    live,
  );
  if (!phrase) return null;
  return (
    <p className="text-sm text-at-muted">
      <span className="font-semibold text-at-ink">Narrowed to {phrase}.</span> The figures, the
      cancellations and the route rankings follow it; the worst-of cards and the vehicle counts
      cover the whole {window}.
    </p>
  );
}
