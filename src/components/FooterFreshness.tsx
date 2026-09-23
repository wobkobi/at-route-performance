// src/components/FooterFreshness.tsx
// Async server component that fetches data freshness and renders the footer line.

import { DataFreshness } from "@/components/DataFreshness";
import { readFallback } from "@/lib/db";
import { getDataFreshness, INGEST_INTERVAL_SEC } from "@/lib/ingest-run";
import type { JSX } from "react";

/**
 * Async server component: fetches data freshness and renders the footer line.
 * Wrapped in `<Suspense>` in the root layout so the footer skeleton shows
 * immediately while this resolves, unblocking the page render.
 *
 * It swallows its own errors because of where it sits. This renders inside the
 * root layout, and a layout that throws takes the whole document to
 * `global-error`, unstyled, on every page at once - so an unreachable database
 * would cost the reader the entire site to save one line of footer text. A page
 * that needs the database still fails through its own error boundary, which is
 * the one that can say something useful.
 * @returns Freshness display, a fallback before the first ingest, or one for a
 *   figure that could not be read.
 */
export async function FooterFreshness(): Promise<JSX.Element> {
  // undefined is the read failing, null is a database with nothing in it yet.
  // Telling a reader "awaiting first data" during an outage would be a lie.
  const freshness = await getDataFreshness().catch(readFallback("data-freshness", undefined));
  if (freshness === undefined) {
    return <p className="text-xs text-white/50">Last update unknown.</p>;
  }
  if (!freshness) {
    return <p className="text-xs text-white/50">Awaiting first data.</p>;
  }
  return (
    <DataFreshness
      lastUpdatedIso={freshness.lastUpdated.toISOString()}
      nextUpdateIso={freshness.nextUpdate.toISOString()}
      source={freshness.source}
      intervalSec={INGEST_INTERVAL_SEC}
    />
  );
}
