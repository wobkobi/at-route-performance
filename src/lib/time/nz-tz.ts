// src/lib/time/nz-tz.ts
// The one place the IANA timezone name is written. service-day.ts re-exports it
// with the helpers built on it; this leaf exists so lib/format.ts, which
// service-day.ts imports, can read the constant without an import cycle. A lint
// rule rejects the literal anywhere else, because a hand-written timezone is how
// a file ends up doing its own date maths and how a DST bug gets in.

/** IANA name of the Auckland timezone. */
export const NZ_TZ = "Pacific/Auckland";
