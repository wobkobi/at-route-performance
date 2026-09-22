// src/lib/fleet-store.ts
// The fleet register: every vehicle the feed has named, with its fleet label and
// plate. The realtime ingest upserts it each poll; the vehicle pages read it,
// since arrival rows carry only the feed id.

import { DUPLICATE_KEY, prisma, runCommand, throwOnWriteErrors } from "@/lib/db";
import type { FleetEntry } from "@/lib/vehicles";

/** A vehicle as the register holds it. */
export interface FleetVehicle {
  id: string;
  label: string | null;
  plate: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * Upsert every vehicle in one poll's feed read, in one command. A field the feed
 * left out keeps its stored value, so a label that drops out of one read does not
 * blank the register.
 * @param fleet - The vehicles in the read.
 * @param at - When the read was taken.
 * @returns Count of rows written (matched or upserted).
 */
export async function recordFleet(fleet: FleetEntry[], at: Date = new Date()): Promise<number> {
  if (fleet.length === 0) return 0;
  const seen = { $date: at.toISOString() };
  const res = (await runCommand(() =>
    prisma.$runCommandRaw({
      update: "Vehicle",
      updates: fleet.map((v) => ({
        q: { _id: v.id },
        u: {
          $set: {
            lastSeenAt: seen,
            ...(v.label ? { label: v.label } : {}),
            ...(v.plate ? { plate: v.plate } : {}),
          },
          $setOnInsert: { firstSeenAt: seen },
        },
        upsert: true,
      })),
      ordered: false,
    }),
  )) as unknown as { n?: number };
  // Two overlapping polls can race the same upsert; the loser's duplicate key
  // means the row exists.
  throwOnWriteErrors(res, [DUPLICATE_KEY], "Vehicle upsert");
  return res.n ?? 0;
}

/**
 * The register's rows for these vehicles.
 * @param ids - Feed vehicle ids.
 * @returns Vehicle id > its row; ids never seen are absent.
 */
export async function getFleet(ids: string[]): Promise<Map<string, FleetVehicle>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.vehicle.findMany({ where: { id: { in: ids } } });
  return new Map(rows.map((r) => [r.id, r]));
}
