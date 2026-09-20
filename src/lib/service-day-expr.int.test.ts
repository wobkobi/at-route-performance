// src/lib/service-day-expr.int.test.ts
// Proves MongoDB evaluates serviceDateExpr exactly as nzServiceDayString labels
// the same instants, across both DST switches and the 4am boundary. Runs a
// collectionless `$documents` pipeline, so it reads and writes no collection.
// Needs DATABASE_URL: `npm run test:int`.
import { prisma } from "@/lib/db";
import { serviceDateExpr } from "@/lib/service-day-expr";
import { nzServiceDayString } from "@/lib/time";
import { afterAll, describe, expect, it } from "vitest";

/** Instants around the boundaries that matter, with the service date each belongs to. */
const CASES: { iso: string; local: string; expected: string }[] = [
  // NZDT starts Sun 27 Sep 2026 (02:00 NZST > 03:00 NZDT).
  { iso: "2026-09-26T14:30:00Z", local: "27 Sep 03:30 NZDT", expected: "2026-09-26" },
  { iso: "2026-09-26T14:59:59Z", local: "27 Sep 03:59:59 NZDT", expected: "2026-09-26" },
  { iso: "2026-09-26T15:00:00Z", local: "27 Sep 04:00 NZDT", expected: "2026-09-27" },
  { iso: "2026-09-26T15:30:00Z", local: "27 Sep 04:30 NZDT", expected: "2026-09-27" },
  { iso: "2026-09-26T19:30:00Z", local: "27 Sep 08:30 NZDT", expected: "2026-09-27" },
  { iso: "2026-09-26T13:30:00Z", local: "27 Sep 01:30 NZST", expected: "2026-09-26" },
  // NZDT ends Sun 5 Apr 2026 (03:00 NZDT > 02:00 NZST).
  { iso: "2026-04-04T12:30:00Z", local: "5 Apr 01:30 NZDT", expected: "2026-04-04" },
  { iso: "2026-04-04T15:30:00Z", local: "5 Apr 03:30 NZST", expected: "2026-04-04" },
  { iso: "2026-04-04T16:00:00Z", local: "5 Apr 04:00 NZST", expected: "2026-04-05" },
  { iso: "2026-04-04T16:30:00Z", local: "5 Apr 04:30 NZST", expected: "2026-04-05" },
  // Ordinary days in each half of the year, either side of the boundary.
  { iso: "2026-06-14T15:59:59Z", local: "15 Jun 03:59:59 NZST", expected: "2026-06-14" },
  { iso: "2026-06-14T16:00:00Z", local: "15 Jun 04:00 NZST", expected: "2026-06-15" },
  { iso: "2026-06-14T16:59:00Z", local: "15 Jun 04:59 NZST", expected: "2026-06-15" },
  { iso: "2026-01-14T14:59:00Z", local: "15 Jan 03:59 NZDT", expected: "2026-01-14" },
  { iso: "2026-01-14T15:00:00Z", local: "15 Jan 04:00 NZDT", expected: "2026-01-15" },
  { iso: "2026-12-31T12:30:00Z", local: "1 Jan 01:30 NZDT", expected: "2026-12-31" },
];

describe("serviceDateExpr on MongoDB", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("labels every boundary instant as nzServiceDayString does", async () => {
    const res = (await prisma.$runCommandRaw({
      aggregate: 1,
      pipeline: [
        { $documents: CASES.map((c) => ({ local: c.local, at: { $date: c.iso } })) },
        { $project: { _id: 0, local: 1, date: serviceDateExpr("$at") } },
      ],
      cursor: {},
    })) as unknown as { cursor: { firstBatch: { local: string; date: string }[] } };

    const got = new Map(res.cursor.firstBatch.map((r) => [r.local, r.date]));
    for (const c of CASES) {
      expect(nzServiceDayString(new Date(c.iso)), `helper: ${c.local}`).toBe(c.expected);
      expect(got.get(c.local), `mongo: ${c.local}`).toBe(c.expected);
    }
  });
});
