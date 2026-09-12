// src/lib/service-day-expr.ts
// The MongoDB aggregation expression for an instant's NZ service date, the
// pipeline twin of nzServiceDayString in time.ts. Every board that groups events
// by service day must bucket exactly as the TypeScript helper labels, or a row
// lands under a day the page cannot navigate to.
import { SERVICE_START_HOUR } from "@/lib/time";
import type { Prisma } from "@prisma/client";

const NZ_TZ = "Pacific/Auckland";

/**
 * Aggregation expression yielding the service date (`YYYY-MM-DD`) of a date
 * field, exactly as {@link SERVICE_START_HOUR} and `nzServiceDayString` define
 * it: the Auckland calendar date of the instant, or the previous date when the
 * Auckland hour is before the start hour. Decided from the local hour rather
 * than by subtracting five absolute hours and truncating, which on a DST-switch
 * day shifts across the transition and files a 05:30 run under the day before.
 * The day step is taken in Auckland time so it stays one calendar day long
 * through a 23- or 25-hour day.
 * @param field - Field path of the instant, with its `$` ("$scheduledAt").
 * @param startHour - Local hour the service day begins (default {@link SERVICE_START_HOUR}).
 * @returns An expression that evaluates to the `YYYY-MM-DD` service date string,
 * typed as the JSON `$runCommandRaw` accepts so it drops into an uncast pipeline.
 */
export function serviceDateExpr(
  field: string,
  startHour: number = SERVICE_START_HOUR,
): Prisma.InputJsonObject {
  return {
    $dateToString: {
      format: "%Y-%m-%d",
      timezone: NZ_TZ,
      date: {
        $cond: [
          { $lt: [{ $hour: { date: field, timezone: NZ_TZ } }, startHour] },
          { $dateSubtract: { startDate: field, unit: "day", amount: 1, timezone: NZ_TZ } },
          field,
        ],
      },
    },
  };
}
