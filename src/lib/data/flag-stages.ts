// src/lib/data/flag-stages.ts
// How far each cancelled trip got, from its recorded arrivals against the flag. A leaf (no
// cache layer), so the nightly cron can classify a day's flags without the page-read imports.
import { pushTo } from "@/lib/collections";
import { prisma } from "@/lib/db";
import { serviceDayScanRange } from "@/lib/time/service-day";
import { cancellationStage, type CancellationStage } from "@/lib/trip/cancellation";

/** A stored cancellation flag: the trip, its service day and when the flag was first seen. */
export interface FlagKey {
  tripId: string;
  /** The run's own service date (`YYYY-MM-DD`). */
  serviceDate: string;
  detectedAt: Date;
}

/**
 * The key {@link flagStages} files each flag's stage under.
 * @param flag - The trip and its service date.
 * @param flag.tripId - Trip id.
 * @param flag.serviceDate - Service date (`YYYY-MM-DD`).
 * @returns `tripId|serviceDate`.
 */
export function flagKey({ tripId, serviceDate }: { tripId: string; serviceDate: string }): string {
  return `${tripId}|${serviceDate}`;
}

/**
 * Each flag's stage, from the real (non-ghost) arrivals its trip recorded on
 * the flag's own service day. One indexed read for the whole set: the trip ids
 * lead the ArrivalEvent unique key, and the window spans the flags' days plus
 * the run tail, so a run cut short after 4am still shows the calls it made.
 * Each arrival is then matched to a flag by its stamped service date.
 * @param flags - The cancellation flags to classify.
 * @returns Stage per flag, keyed by {@link flagKey}.
 */
export async function flagStages(
  flags: readonly FlagKey[],
): Promise<Map<string, CancellationStage>> {
  const out = new Map<string, CancellationStage>();
  if (flags.length === 0) return out;
  const dates = [...new Set(flags.map((f) => f.serviceDate))];
  const days = dates.map((d) => serviceDayScanRange(d));
  const start = new Date(Math.min(...days.map((d) => d.start.getTime())));
  const end = new Date(Math.max(...days.map((d) => d.end.getTime())));
  const events = await prisma.arrivalEvent.findMany({
    where: {
      tripId: { in: [...new Set(flags.map((f) => f.tripId))] },
      scheduledAt: { gte: start, lt: end },
      serviceDate: { in: dates },
    },
    select: { tripId: true, serviceDate: true, actualAt: true, ghost: true },
  });
  const arrivalsByRun = new Map<string, string[]>();
  for (const e of events) {
    if (e.ghost === true || e.serviceDate === null) continue;
    pushTo(
      arrivalsByRun,
      flagKey({ tripId: e.tripId, serviceDate: e.serviceDate }),
      e.actualAt.toISOString(),
    );
  }
  for (const f of flags) {
    const key = flagKey(f);
    out.set(key, cancellationStage(f.detectedAt.toISOString(), arrivalsByRun.get(key) ?? []));
  }
  return out;
}
