// src/lib/auth.ts
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * Guard an ingest endpoint with a constant-time CRON_SECRET bearer check.
 * Compares in constant time to avoid leaking the secret via response timing.
 * @param req - Incoming request.
 * @returns A 500/401 response to return early, or null when the request is authorised.
 */
export function requireCronAuth(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[auth] CRON_SECRET not configured");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const provided = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  const ok = provided.length === expected.length && timingSafeEqual(provided, expected);

  if (!ok) {
    console.warn("[auth] Unauthorised ingest attempt", {
      ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
