// src/app/api/routes/route.ts
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";

const Body = z.object({
  id: z.string().min(1), // AT route_id
  longName: z.string().min(1),
  shortName: z.string().optional(),
  mode: z.enum(["BUS", "TRAIN", "FERRY"]),
});
type RouteBody = z.infer<typeof Body>;

/**
 * Create a new route.
 * Validates input and inserts a Route record.
 * @param req HTTP request containing JSON {@link RouteBody}.
 * @returns JSON of the created route or a 400 error on invalid input.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const r = await prisma.route.create({ data: parsed.data });
  return NextResponse.json(r, { status: 201 });
}

/**
 * List all routes ordered by long name.
 * @returns JSON array of routes.
 */
export async function GET(): Promise<NextResponse> {
  const r = await prisma.route.findMany({ orderBy: { longName: "asc" } });
  return NextResponse.json(r);
}
