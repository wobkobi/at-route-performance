// src/app/api/stops/route.ts
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";

const Body = z.object({
  id: z.string().min(1), // <-- add id
  name: z.string().min(1),
  code: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
type StopBody = z.infer<typeof Body>;

/**
 * Create a new stop.
 * Validates input and inserts a Stop record.
 * @param req HTTP request containing JSON {@link StopBody}.
 * @returns JSON of the created stop or 400 on invalid input.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const s = await prisma.stop.create({ data: parsed.data });
  return NextResponse.json(s, { status: 201 });
}

/**
 * List all stops ordered by name.
 * @returns JSON array of stops.
 */
export async function GET(): Promise<NextResponse> {
  const s = await prisma.stop.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(s);
}
