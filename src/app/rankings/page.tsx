import { FleetSummary } from "@/components/FleetSummary";
import { ModeBreakdown } from "@/components/ModeBreakdown";
import { RankBoard } from "@/components/RankBoard";
import { RouteTable, type RouteSort } from "@/components/RouteTable";
import { WindowControls } from "@/components/WindowControls";
import { cn } from "@/lib/cn";
import { getFleetSummary, getLatestEventDate, getModeBreakdown, getRankings } from "@/lib/data";
import { deriveBoards, MIN_BOARD_EVENTS, sortRows } from "@/lib/rankings";
import { isoWeekString, nzMonthRange, nzWeekRange, type DateRange } from "@/lib/time";
import type { JSX } from "react";

const THRESHOLD_SEC = 300;
const REVALIDATE = 3600; // 1 hour

/** Query params for the rankings page. */
interface RankingsSearchParams {
  window?: string;
  period?: string;
  sort?: string;
}

/**
 * Month key like `2026-06` from an instant, in Auckland local time.
 * @param d - Instant.
 * @returns `YYYY-MM`.
 */
function monthKey(d: Date): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
  });
  return f.format(d);
}

/**
 * Human month label like `June 2026` from a range start.
 * @param d - Range start (UTC instant of local month start).
 * @returns Formatted label.
 */
function monthLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    month: "long",
    year: "numeric",
  }).format(new Date(d.getTime() + 86_400_000));
}

/**
 * Resolve the active range + label, falling back to the latest period with data.
 * @param window - "week" or "month".
 * @param period - Explicit period (e.g. "2026-W25" or "2026-06"), optional.
 * @returns The range and a human label.
 */
async function resolveRange(
  window: "week" | "month",
  period?: string,
): Promise<{ range: DateRange; label: string }> {
  if (window === "month") {
    let range = nzMonthRange(period);
    let label = monthLabel(range.start);
    if (!period && (await getRankings(range, THRESHOLD_SEC, REVALIDATE)).length === 0) {
      const latest = await getLatestEventDate();
      if (latest) {
        range = nzMonthRange(monthKey(latest));
        label = monthLabel(range.start);
      }
    }
    return { range, label };
  }
  let range = nzWeekRange(period);
  let label = period ?? isoWeekString(range.start);
  if (!period && (await getRankings(range, THRESHOLD_SEC, REVALIDATE)).length === 0) {
    const latest = await getLatestEventDate();
    if (latest) {
      const wk = isoWeekString(latest);
      range = nzWeekRange(wk);
      label = wk;
    }
  }
  return { range, label };
}

/**
 * Rankings page: week or month network performance.
 * @param root0 - Page props.
 * @param root0.searchParams - Window, period, and sort params.
 * @returns Page markup.
 */
export default async function RankingsPage({
  searchParams,
}: {
  searchParams?: Promise<RankingsSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const window = sp.window === "month" ? "month" : "week";
  const sort = (
    ["route", "events", "avg_delay", "on_time"].includes(sp.sort ?? "") ? sp.sort : "on_time"
  ) as RouteSort;

  const { range, label } = await resolveRange(window, sp.period);
  const [rows, fleet, modes] = await Promise.all([
    getRankings(range, THRESHOLD_SEC, REVALIDATE),
    getFleetSummary(range, THRESHOLD_SEC, REVALIDATE),
    getModeBreakdown(range, THRESHOLD_SEC, REVALIDATE),
  ]);
  const boards = deriveBoards(rows, { minEvents: MIN_BOARD_EVENTS });
  const preserved: Record<string, string> = { window, ...(sp.period ? { period: sp.period } : {}) };

  return (
    <main className={cn("space-y-6")}>
      <div className={cn("flex flex-wrap items-end justify-between gap-3")}>
        <h1 className={cn("text-3xl leading-headline font-ultra tracking-zero")}>Top routes</h1>
        <WindowControls window={window} periodLabel={label} />
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

      <RouteTable
        rows={sortRows(rows, sort)}
        basePath="/rankings"
        preservedParams={preserved}
        sort={sort}
      />
    </main>
  );
}
