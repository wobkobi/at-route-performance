// src/app/live/page.tsx
// Live now: every bus, train and ferry on a run right now, as a network map and
// a table of the routes running, each with how its vehicles sit against the
// on-time window. Read from AT's live feed, which the site caches for two minutes.

import { ChipLink } from "@/components/Chip";
import LiveMapWrapper from "@/components/LiveMapWrapper";
import { LiveFiguresSkeleton, LiveTableSkeleton } from "@/components/LiveSkeleton";
import { ModeFilter, type ModeFilterValue } from "@/components/ModeFilter";
import { ModeIcon } from "@/components/ModeIcon";
import { SortHeader } from "@/components/SortHeader";
import { cn } from "@/lib/cn";
import { ON_TIME_WINDOW_NOTE } from "@/lib/copy";
import { getDirectoryRoutes, getRouteModeMap } from "@/lib/data/routes";
import { logReadFailure, readFallback } from "@/lib/db";
import { OFF_SCHEDULE_TONE_CLASS, offScheduleValue } from "@/lib/format";
import { lineName } from "@/lib/line-name";
import {
  liveRoutes,
  liveTotals,
  parseLiveSort,
  type LiveRouteRow,
  type LiveSort,
} from "@/lib/live-routes";
import { routeSlug } from "@/lib/route-slug";
import { buildHref } from "@/lib/utils";
import { getLiveVehicles } from "@/lib/vehicles";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type JSX } from "react";

export const metadata: Metadata = {
  title: "Live now",
  description:
    "Every Auckland bus, train and ferry on a run right now, on a map and by route, with how many are running late.",
};

/** Query params for the live page. */
interface LiveSearchParams {
  mode?: string;
  sort?: string;
  all?: string;
}

/** Routes the table opens with; `?all=1` lists every one. */
const TABLE_ROWS = 30;

const SORT_LABEL: Record<LiveSort, string> = {
  running: "Most running",
  late: "Most late",
};

/**
 * Live now page. The header, chips and map render at once; the figures and the
 * table wait on AT's feed in their own boundary.
 * @param root0 - Page props.
 * @param root0.searchParams - `mode`, `sort` and `all`.
 * @returns Page markup.
 */
export default async function LivePage({
  searchParams,
}: {
  searchParams?: Promise<LiveSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const mode = (
    ["BUS", "TRAIN", "FERRY"].includes(sp.mode ?? "") ? sp.mode : null
  ) as ModeFilterValue;
  const sort = parseLiveSort(sp.sort);
  const sortParam = sort === "running" ? undefined : sort;
  const all = sp.all === "1";

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">Live now</h1>
        <p className="mt-0.5 text-sm text-at-muted">
          Every bus, train and ferry on a run right now. Refreshes every two minutes.
        </p>
      </header>

      <ModeFilter
        active={mode}
        basePath="/live"
        preservedParams={{
          ...(sortParam ? { sort: sortParam } : {}),
          ...(all ? { all: "1" } : {}),
        }}
      />

      <Suspense fallback={<LiveFiguresSkeleton />}>
        <LiveFigures mode={mode} />
      </Suspense>

      <section aria-labelledby="live-map" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="live-map" className="text-lg font-ultra tracking-zero text-at-ink">
            Where they are
          </h2>
          <DotKey />
        </div>
        <LiveMapWrapper mode={mode} className="h-110 border border-at-border sm:h-140" />
        <p className="text-xs text-at-muted">
          Tap a dot for its route, how late it is, and links to its run and the vehicle. Buses are
          the small dots. The table below lists the same routes.
        </p>
      </section>

      <section aria-labelledby="live-routes" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="live-routes" className="text-lg font-ultra tracking-zero text-at-ink">
            Routes running
          </h2>
          <nav aria-label="Order by" className="flex flex-wrap gap-2">
            {(Object.keys(SORT_LABEL) as LiveSort[]).map((s) => (
              <ChipLink
                key={s}
                href={buildHref("/live", {
                  mode: mode ?? undefined,
                  sort: s === "running" ? undefined : s,
                  all: all ? "1" : undefined,
                })}
                active={s === sort}
              >
                {SORT_LABEL[s]}
              </ChipLink>
            ))}
          </nav>
        </div>
        <Suspense fallback={<LiveTableSkeleton />}>
          <LiveTable mode={mode} sort={sort} all={all} />
        </Suspense>
      </section>

      <p className="text-xs text-at-muted">
        Each vehicle is placed on the same on-time window as the rest of the site, from the delay
        AT&apos;s trip feed gives for its next stop. {ON_TIME_WINDOW_NOTE} Vehicles between runs are
        left out, and one with no delay in the feed counts as running but in no band.
      </p>
    </main>
  );
}

/**
 * The feed folded into route rows for one mode. Throws when either source is
 * down - AT's feed or the database behind the mode map - so each caller can say
 * so in its own place.
 * @param mode - The mode filter.
 * @param sort - The table's order.
 * @returns The rows.
 */
async function loadRows(mode: ModeFilterValue, sort: LiveSort): Promise<LiveRouteRow[]> {
  const [vehicles, modes] = await Promise.all([getLiveVehicles(), getRouteModeMap()]);
  const rows = liveRoutes(vehicles, modes, sort);
  return mode ? rows.filter((r) => r.mode === mode) : rows;
}

/**
 * The share of a count in a total, as a whole percentage.
 * @param n - The count.
 * @param total - The total.
 * @returns "12%", or null for an empty total.
 */
function pct(n: number, total: number): string | null {
  return total > 0 ? `${Math.round((n / total) * 100)}%` : null;
}

/**
 * The figure strip: vehicles and routes running, and how the timed ones split.
 * @param props - Component props.
 * @param props.mode - The mode filter.
 * @returns The strip.
 */
async function LiveFigures({ mode }: { mode: ModeFilterValue }): Promise<JSX.Element> {
  let rows: LiveRouteRow[];
  try {
    rows = await loadRows(mode, "running");
  } catch (err) {
    // loadRows reads the route mode map from the database as well as AT's feed,
    // so this catches an outage of either. Naming AT would blame a third party
    // for what may be this site's own database, and the log is what makes the
    // database case visible at all - the reader still gets the page.
    logReadFailure("live-figures", err);
    return (
      <div className="border border-at-border bg-at-surface px-6 py-5 text-sm text-at-muted">
        The live figures could not be read just now. Try again in a couple of minutes.
      </div>
    );
  }
  const t = liveTotals(rows);
  const timed = t.late + t.onTime + t.early;
  const figures: Array<{ label: string; value: string; note?: string | null; tone?: string }> = [
    { label: "On a run", value: t.vehicles.toLocaleString("en-NZ") },
    { label: "Routes running", value: t.routes.toLocaleString("en-NZ") },
    {
      label: "Late",
      value: t.late.toLocaleString("en-NZ"),
      note: pct(t.late, timed),
      tone: "text-at-late",
    },
    {
      label: "On time",
      value: t.onTime.toLocaleString("en-NZ"),
      note: pct(t.onTime, timed),
      tone: "text-at-ontime",
    },
    {
      label: "Early",
      value: t.early.toLocaleString("en-NZ"),
      note: pct(t.early, timed),
      tone: "text-at-early-strong",
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-4 border border-at-border bg-at-surface px-6 py-5 sm:grid-cols-5">
      {figures.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="text-xs tracking-zero text-at-muted uppercase">{f.label}</dt>
          <dd className={cn("text-2xl font-ultra tabular-nums", f.tone ?? "text-at-ink")}>
            {f.value}
          </dd>
          {f.note !== undefined && (
            <dd className="text-xs text-at-muted tabular-nums">
              {f.note ? `${f.note} of those with a delay` : " "}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/**
 * The routes running, one row each.
 * @param props - Component props.
 * @param props.mode - The mode filter.
 * @param props.sort - The order.
 * @param props.all - List every route rather than the first page.
 * @returns The table.
 */
async function LiveTable({
  mode,
  sort,
  all,
}: {
  mode: ModeFilterValue;
  sort: LiveSort;
  all: boolean;
}): Promise<JSX.Element> {
  let rows: LiveRouteRow[];
  let names: Map<string, string>;
  try {
    const [r, directory] = await Promise.all([
      loadRows(mode, sort),
      getDirectoryRoutes().catch(readFallback("directory-routes", [])),
    ]);
    rows = r;
    names = new Map(
      directory.map((d) => [routeSlug(d.id), lineName(d.mode, d.shortName) ?? d.longName ?? ""]),
    );
  } catch (err) {
    // Same pair of sources as LiveFigures above, so the same reasoning applies.
    logReadFailure("live-routes", err);
    return (
      <div className="border border-at-border bg-at-surface px-6 py-5 text-sm text-at-muted">
        No live positions to list: they could not be read just now.
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="border border-at-border bg-at-surface px-6 py-5 text-sm text-at-muted">
        Nothing is on a run right now. Late at night the network runs few or no services.
      </div>
    );
  }
  const shown = all ? rows : rows.slice(0, TABLE_ROWS);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto border border-at-border bg-at-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-at-border text-left text-xs tracking-wide text-at-muted uppercase">
              <th scope="col" className="p-3 font-semibold">
                Route
              </th>
              <SortHeader active={sort === "running"}>Running</SortHeader>
              <SortHeader active={sort === "late"}>Late</SortHeader>
              <SortHeader className="hidden sm:table-cell">On time</SortHeader>
              <SortHeader className="hidden sm:table-cell">Early</SortHeader>
              <SortHeader className="hidden md:table-cell">Avg delay</SortHeader>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const name = names.get(r.slug);
              const avg = offScheduleValue(r.avgDelaySec, null, r.mode);
              return (
                <tr key={r.slug} className="border-b border-at-border last:border-b-0">
                  <th scope="row" className="p-3 text-left font-normal">
                    <Link
                      href={`/route/${encodeURIComponent(r.slug)}`}
                      className="flex min-w-0 items-center gap-2 hover:underline"
                    >
                      <ModeIcon mode={r.mode} className="h-4 w-4 shrink-0" />
                      <span className="font-semibold text-at-shore">{r.slug}</span>
                      {name && name !== r.slug && (
                        <span className="hidden truncate text-at-muted sm:inline">{name}</span>
                      )}
                    </Link>
                  </th>
                  <td className="p-3 text-right tabular-nums">{r.vehicles}</td>
                  <td className={cn("p-3 text-right tabular-nums", r.late > 0 && "text-at-late")}>
                    {r.late}
                  </td>
                  <td className="hidden p-3 text-right tabular-nums sm:table-cell">{r.onTime}</td>
                  <td className="hidden p-3 text-right tabular-nums sm:table-cell">{r.early}</td>
                  <td
                    className={cn(
                      "hidden p-3 text-right whitespace-nowrap tabular-nums md:table-cell",
                      OFF_SCHEDULE_TONE_CLASS[avg.tone],
                    )}
                  >
                    {avg.text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length < rows.length && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-at-muted tabular-nums">
            Showing {shown.length} of {rows.length} routes
          </p>
          <ChipLink
            href={buildHref("/live", {
              mode: mode ?? undefined,
              sort: sort === "running" ? undefined : sort,
              all: "1",
            })}
          >
            Show all
          </ChipLink>
        </div>
      )}
    </div>
  );
}

/**
 * The map's dot colours, including the grey for a vehicle with no delay.
 * @returns The key.
 */
function DotKey(): JSX.Element {
  const dots: Array<[string, string]> = [
    ["bg-at-late", "late"],
    ["bg-at-ontime", "on time"],
    ["bg-at-early-strong", "early"],
    ["bg-at-muted", "no delay"],
  ];
  return (
    <span className="flex flex-wrap items-center gap-3 text-xs text-at-muted">
      {dots.map(([bg, label]) => (
        <span key={label} className="flex items-center gap-1">
          <span className={cn("inline-block h-2.5 w-2.5 rounded-full", bg)} /> {label}
        </span>
      ))}
    </span>
  );
}
