import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";

/** Zod schema for arrival ingest payload. */
const Body = z.object({
  routeId: z.string().min(1),
  stopId: z.string().min(1),
  scheduledAt: z.string().datetime(), // ISO-8601
  actualAt: z.string().datetime(), // ISO-8601
  tripId: z.string().optional(),
  vehicleId: z.string().optional(),
  source: z.string().optional(),
});

type ArrivalBody = z.infer<typeof Body>;

/**
 * Ingest a single arrival/departure event.
 * Computes deviationSec = actual - scheduled.
 * @param req HTTP request with JSON body matching {@link ArrivalBody}.
 * @returns 201 with created record, or 400 on validation error.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const s = new Date(parsed.data.scheduledAt);
  const a = new Date(parsed.data.actualAt);
  const deviationSec = Math.round((a.getTime() - s.getTime()) / 1000);

  const rec = await prisma.arrivalEvent.create({
    data: { ...parsed.data, scheduledAt: s, actualAt: a, deviationSec },
  });
  return NextResponse.json(rec, { status: 201 });
}
