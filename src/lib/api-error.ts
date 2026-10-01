// src/lib/api-error.ts
// The one error body every API route answers with: a stable `error` code a
// client can branch on, a `message` for a person reading the response, and any
// extra fields a client still renders from (an empty list, the failed fields).
// Exception text never goes into a body; it goes to the log.

import { isDatabaseUnreachableError, logReadFailure } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * Why a request failed, one code per HTTP status:
 * - `invalid_query` (400): the query or body did not validate.
 * - `unauthorized` (401): the bearer token was missing or wrong (HTTP's own spelling).
 * - `misconfigured` (500): a required environment variable is unset.
 * - `server_error` (500): anything else that threw on this side.
 * - `upstream_failed` (502): AT's API did not answer usefully.
 * - `database_unreachable` (503): the self-hosted database could not be reached.
 */
export type ApiErrorCode =
  | "invalid_query"
  | "unauthorized"
  | "misconfigured"
  | "server_error"
  | "upstream_failed"
  | "database_unreachable";

/** The error envelope's own fields. */
export interface ApiErrorBody {
  error: ApiErrorCode;
  message: string;
}

/**
 * An error response in the shared envelope.
 * @param status - The HTTP status.
 * @param error - The machine-readable code.
 * @param message - A sentence for a person reading the response.
 * @param extra - Fields a client still renders from, such as an empty list.
 * @returns The JSON response.
 */
export function apiError(
  status: number,
  error: ApiErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ ...extra, error, message } satisfies ApiErrorBody, { status });
}

/**
 * The response for a handler whose reads threw: 503 when the database could
 * not be reached, 502 for any other failure of a handler that mainly reads AT's
 * feed, and 500 for the rest. Database failures log through
 * {@link logReadFailure}, so they carry the alertable marker; an AT feed failure
 * is an ordinary outage and logs under `[API]` instead, so it never buries that
 * signal.
 * @param read - Names the handler in the log line.
 * @param err - What was thrown.
 * @param options - Response options.
 * @param options.extra - Fields a client still renders from, such as an empty list.
 * @param options.upstream - Whether the handler's main dependency is AT's API, so a
 *   failure that is not the database answers 502 rather than 500.
 * @returns The JSON response.
 */
export function readFailed(
  read: string,
  err: unknown,
  { extra, upstream = false }: { extra?: Record<string, unknown>; upstream?: boolean } = {},
): NextResponse {
  if (isDatabaseUnreachableError(err)) {
    logReadFailure(read, err);
    return apiError(503, "database_unreachable", "The database could not be reached.", extra);
  }
  if (upstream) {
    console.error(`[API] ${read} failed`, err instanceof Error ? err.message : err);
    return apiError(502, "upstream_failed", "AT's live feed could not be read.", extra);
  }
  logReadFailure(read, err);
  return apiError(500, "server_error", "The request failed.", extra);
}
