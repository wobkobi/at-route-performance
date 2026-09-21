// tests/lib/service-day-expr.test.ts
// Shape test for the service-date aggregation expression. The
// service-day-expr.int.test.ts run proves MongoDB evaluates it as
// nzServiceDayString does.
import { serviceDateExpr } from "@/lib/service-day-expr";
import { NZ_TZ } from "@/lib/time";
import { describe, expect, it } from "vitest";

describe("serviceDateExpr", () => {
  it("decides the day from the Auckland hour and steps back a local day before 4am", () => {
    expect(serviceDateExpr("$scheduledAt")).toEqual({
      $dateToString: {
        format: "%Y-%m-%d",
        timezone: NZ_TZ,
        date: {
          $cond: [
            { $lt: [{ $hour: { date: "$scheduledAt", timezone: NZ_TZ } }, 4] },
            {
              $dateSubtract: {
                startDate: "$scheduledAt",
                unit: "day",
                amount: 1,
                timezone: NZ_TZ,
              },
            },
            "$scheduledAt",
          ],
        },
      },
    });
  });

  it("takes a different start hour", () => {
    expect(serviceDateExpr("$at", 3)).toEqual({
      $dateToString: {
        format: "%Y-%m-%d",
        timezone: NZ_TZ,
        date: {
          $cond: [
            { $lt: [{ $hour: { date: "$at", timezone: NZ_TZ } }, 3] },
            {
              $dateSubtract: {
                startDate: "$at",
                unit: "day",
                amount: 1,
                timezone: NZ_TZ,
              },
            },
            "$at",
          ],
        },
      },
    });
  });
});
