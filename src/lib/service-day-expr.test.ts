// src/lib/service-day-expr.test.ts
// Shape test for the service-date aggregation expression. The
// service-day-expr.int.test.ts run proves MongoDB evaluates it as
// nzServiceDayString does.
import { serviceDateExpr } from "@/lib/service-day-expr";
import { describe, expect, it } from "vitest";

describe("serviceDateExpr", () => {
  it("decides the day from the Auckland hour and steps back a local day before 5am", () => {
    expect(serviceDateExpr("$scheduledAt")).toEqual({
      $dateToString: {
        format: "%Y-%m-%d",
        timezone: "Pacific/Auckland",
        date: {
          $cond: [
            { $lt: [{ $hour: { date: "$scheduledAt", timezone: "Pacific/Auckland" } }, 5] },
            {
              $dateSubtract: {
                startDate: "$scheduledAt",
                unit: "day",
                amount: 1,
                timezone: "Pacific/Auckland",
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
        timezone: "Pacific/Auckland",
        date: {
          $cond: [
            { $lt: [{ $hour: { date: "$at", timezone: "Pacific/Auckland" } }, 3] },
            {
              $dateSubtract: {
                startDate: "$at",
                unit: "day",
                amount: 1,
                timezone: "Pacific/Auckland",
              },
            },
            "$at",
          ],
        },
      },
    });
  });
});
