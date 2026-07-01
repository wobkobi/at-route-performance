// src/components/FooterFreshness.tsx
/**
 * @description Async server component that fetches data freshness and renders the footer line.
 */
import { DataFreshness } from "@/components/DataFreshness";
import { getDataFreshness } from "@/lib/ingest-run";
import type { JSX } from "react";

/**
 * Async server component: fetches data freshness and renders the footer line.
 * Wrapped in `<Suspense>` in the root layout so the footer skeleton shows
 * immediately while this resolves, unblocking the page render.
 * @returns Freshness display, or a fallback when no data has been ingested yet.
 */
export async function FooterFreshness(): Promise<JSX.Element> {
  const freshness = await getDataFreshness();
  if (!freshness) {
    return <p className="text-xs text-white/50">Awaiting first data.</p>;
  }
  return (
    <DataFreshness
      lastUpdatedIso={freshness.lastUpdated.toISOString()}
      nextUpdateIso={freshness.nextUpdate.toISOString()}
    />
  );
}
