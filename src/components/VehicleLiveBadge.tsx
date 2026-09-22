// src/components/VehicleLiveBadge.tsx
// A LIVE badge for a vehicle on a run right now. Awaits the live set inside its
// own Suspense boundary per row, so a board never waits on AT's realtime feed.

import { routeSlug } from "@/lib/route-slug";
import type { LiveVehicle } from "@/lib/vehicles";
import { type JSX, Suspense } from "react";

/** Live vehicles by feed id, as one read of the feed gives them. */
export type LiveVehicleMap = ReadonlyMap<string, LiveVehicle>;

/**
 * The badge, once the live set is in.
 * @param props - Component props.
 * @param props.vehicleId - The vehicle.
 * @param props.live - The live set, unresolved.
 * @returns The badge, or null when the vehicle is not on a run.
 */
async function LiveBadge({
  vehicleId,
  live,
}: {
  vehicleId: string;
  live: Promise<LiveVehicleMap>;
}): Promise<JSX.Element | null> {
  const v = (await live).get(vehicleId);
  if (!v?.tripId) return null;
  return (
    <span
      title={`On a run now, route ${routeSlug(v.routeId)}`}
      className="shrink-0 rounded bg-at-ontime px-1.5 py-0.5 text-xs font-bold text-white"
    >
      LIVE
    </span>
  );
}

/**
 * A LIVE badge for one vehicle, streamed in on its own.
 * @param props - Component props.
 * @param props.vehicleId - The vehicle.
 * @param props.live - Live vehicles by id, unresolved.
 * @returns The boundary.
 */
export function VehicleLiveBadge(props: {
  vehicleId: string;
  live: Promise<LiveVehicleMap>;
}): JSX.Element {
  return (
    <Suspense fallback={null}>
      <LiveBadge {...props} />
    </Suspense>
  );
}
