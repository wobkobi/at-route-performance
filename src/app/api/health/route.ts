// src/app/api/health/route.ts
// Public liveness probe for the post-deploy check: answers with the deployed
// package version so a deploy can be confirmed to be the commit it claims. It
// touches no database and no upstream feed, so it says only that the build is
// up and which build it is; the smoke test that follows exercises the rest.

import { NextResponse } from "next/server";
import pkg from "../../../../package.json";

/**
 * The deployed build's version and the server's clock.
 * @returns JSON `{ ok, version, time }`.
 */
export function GET(): NextResponse {
  return NextResponse.json(
    { ok: true, version: pkg.version, time: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
