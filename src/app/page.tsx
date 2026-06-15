import { FleetSummary } from "@/components/FleetSummary";
import { ModeBreakdown } from "@/components/ModeBreakdown";
import { RankBoard } from "@/components/RankBoard";
import { RouteTable, type RouteSort } from "@/components/RouteTable";
import { cn } from "@/lib/cn";
import { getFleetSummary, getModeBreakdown, getMostRecentDataDay, getRankings } from "@/lib/data";
import { deriveBoards, MIN_BOARD_EVENTS, sortRows } from "@/lib/rankings";
import { nzDayRange } from "@/lib/time";
import type { JSX } from "react";

const THRESHOLD_SEC = 300;
const TODAY_REVALIDATE = 300; // 5 minutes

/** Query params for the home page. */
interface HomeSearchParams {
  sort?: string;
}

/**
 * Home: today's network performance dashboard.
 * @param root0 - Page props.
 * @param root0.searchParams - Optional query params (table sort).
 * @returns Page markup.
 */
export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<HomeSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const sort = (
    ["route", "events", "avg_delay", "on_time"].includes(sp.sort ?? "") ? sp.sort : "on_time"
  ) as RouteSort;

  // Today (Auckland). If today lacks enough data to fill the boards yet (early
  // morning, or ingest still catching up), fall back to the latest day that does.
  let range = nzDayRange();
  let rows = await getRankings(range, THRESHOLD_SEC, TODAY_REVALIDATE);
  let dayLabel = "today";
  if (!rows.some((r) => r.events >= MIN_BOARD_EVENTS)) {
    const latestDay = await getMostRecentDataDay(MIN_BOARD_EVENTS);
    if (latestDay) {
      range = nzDayRange(latestDay);
      rows = await getRankings(range, THRESHOLD_SEC, TODAY_REVALIDATE);
      dayLabel = latestDay.toLocaleDateString("en-NZ", {
        timeZone: "Pacific/Auckland",
        day: "numeric",
        month: "short",
      });
    }
  }

  const [fleet, modes] = await Promise.all([
    getFleetSummary(range, THRESHOLD_SEC, TODAY_REVALIDATE),
    getModeBreakdown(range, THRESHOLD_SEC, TODAY_REVALIDATE),
  ]);
  const boards = deriveBoards(rows, { minEvents: MIN_BOARD_EVENTS });

  return (
    <main className={cn("space-y-6")}>
      <div className={cn("flex items-end justify-between")}>
        <h1 className={cn("text-3xl leading-headline font-ultra tracking-zero")}>
          Network performance
        </h1>
        <span className={cn("text-sm text-at-muted")}>Showing {dayLabel}</span>
      </div>

      <FleetSummary data={fleet} />

      <div className={cn("grid gap-4 md:grid-cols-2")}>
        <RankBoard
          title="Running latest"
          accentClass="text-at-late"
          rows={boards.latest}
          metric="delay"
          thresholdSec={THRESHOLD_SEC}
        />
        <RankBoard
          title="Running earliest"
          accentClass="text-at-early"
          rows={boards.earliest}
          metric="delay"
          thresholdSec={THRESHOLD_SEC}
        />
      </div>

      <div className={cn("grid gap-4 md:grid-cols-2")}>
        <RankBoard
          title="Most reliable"
          accentClass="text-at-ontime"
          rows={boards.reliable}
          metric="onTime"
          thresholdSec={THRESHOLD_SEC}
        />
        <ModeBreakdown modes={modes} />
      </div>

      <a
        href="/rankings?window=week"
        className={cn(
          "flex items-center justify-between rounded-xl bg-at-ocean px-5 py-4 text-white shadow-sm",
        )}
      >
        <span className={cn("font-ultra tracking-zero")}>This week&apos;s top routes</span>
        <span className={cn("text-at-safety")}>View weekly &rsaquo;</span>
      </a>

      <details className={cn("rounded-xl bg-at-surface shadow-sm")}>
        <summary className={cn("cursor-pointer px-4 py-3 font-semibold")}>All routes</summary>
        <div className={cn("p-2")}>
          <RouteTable rows={sortRows(rows, sort)} basePath="/" preservedParams={{}} sort={sort} />
        </div>
      </details>
    </main>
  );
}
