// src/app/live/page.tsx
// Live now: every bus, train and ferry on a run right now, as a network map and
// a table of the routes running, each with how its vehicles sit against the
// on-time window. Read from AT's live feed, which the site caches for two minutes.

import { ChipLink } from "@/components/Chip";
import { ModeFilter } from "@/components/filter/ModeFilter";
import { LoadingBlock } from "@/components/Loading";
import LiveMapWrapper from "@/components/map/LiveMapWrapper";
import { ModeIcon } from "@/components/ModeIcon";
import { SortHeader } from "@/components/SortHeader";
import { cn } from "@/lib/cn";
import { ON_TIME_WINDOW_NOTE } from "@/lib/copy";
import { getDirectoryRoutes, getRouteModeMap, type DirectoryRoute } from "@/lib/data/routes";
import { logReadFailure, readFallback } from "@/lib/db";
import { getLiveVehicles } from "@/lib/feed/vehicles";
import { formatCount, formatPct, OFF_SCHEDULE_TONE_CLASS, offScheduleValue } from "@/lib/format";
import { liveRoutes, liveTotals, type LiveRouteRow, type LiveSort } from "@/lib/live-routes";
import { parseMode, type Mode } from "@/lib/mode";
import {
  sortRows,
  tableSort,
  type SortColumn,
  type SortDir,
  type TableSort,
} from "@/lib/page/table-sort";
import { lineName } from "@/lib/route/line-name";
import { routeSlug } from "@/lib/route/slug";
import { buildHref, stripUnset } from "@/lib/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type JSX } from "react";

// Not yet converted to a prerendered shell: this segment still reads its
// search params and its data above any Suspense boundary, so it is allowed to
// block. Removing this line is what converts the route.
export const instant = false;

export const metadata: Metadata = {
  title: "Live now",
  description:
    "Every Auckland bus, train and ferry on a run right now, on a map and by route, with how many are running late.",
};

/** Query params for the live page. */
interface LiveSearchParams {
  mode?: string;
  /** The sorted column; absent is most running first. */
  sort?: string;
  /** "1" sorts the column the other way. */
  rev?: string;
  all?: string;
}

/** The table's sortable columns; the chips above offer the first two figures too. */
const COLUMNS: SortColumn<LiveRouteRow>[] = [
  { key: "route", value: "slug", first: "asc" },
  { key: "running", value: "vehicles" },
  { key: "late", value: "late" },
  { key: "ontime", value: "onTime" },
  { key: "early", value: "early" },
  { key: "avg", value: "avgDelaySec" },
];

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
 * @param root0.searchParams - `mode`, sort (`sort`, `rev`) and `all`.
 * @returns Page markup.
 */
export default async function LivePage({
  searchParams,
}: {
  searchParams?: Promise<LiveSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const mode = parseMode(sp.mode);
  const all = sp.all === "1";
  const { sort, head, keep } = tableSort(sp, COLUMNS, "running", (p) =>
    buildHref("/live", { mode: mode ?? undefined, ...p, all: all ? "1" : undefined }),
  );

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
        preservedParams={stripUnset({ ...keep, all: all ? "1" : undefined })}
      />

      <Suspense fallback={<LoadingBlock label="Loading the live figures" />}>
        <LiveFigures mode={mode} />
      </Suspense>

      <section aria-labelledby="live-map" className="space-y-3">
        <h2 id="live-map" className="text-lg font-ultra tracking-zero text-at-ink">
          Where they are
        </h2>
        <LiveMapWrapper
          mode={mode}
          className="h-[min(27.5rem,65svh)] border border-at-border sm:h-140"
        />
        <p className="text-xs text-at-muted">
          Tap a dot for its run and vehicle, or a line for the routes on it. Buses are the small
          dots, and each line is drawn in its route&apos;s colour. The buttons above the map show or
          hide each kind of dot and the lines.
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
                active={s === sort?.key}
              >
                {SORT_LABEL[s]}
              </ChipLink>
            ))}
          </nav>
        </div>
        <Suspense fallback={<LoadingBlock label="Loading the routes running" />}>
          <LiveTable mode={mode} sort={sort} head={head} keep={keep} all={all} />
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
 * @param sort - The table's sort; level rows keep the most-running order.
 * @returns The rows.
 */
async function loadRows(mode: Mode | null, sort: TableSort | null): Promise<LiveRouteRow[]> {
  const [vehicles, modes] = await Promise.all([getLiveVehicles(), getRouteModeMap()]);
  const rows = sortRows(liveRoutes(vehicles, modes, "running"), COLUMNS, sort);
  return mode ? rows.filter((r) => r.mode === mode) : rows;
}

/**
 * The share of a count in a total, as a percentage.
 * @param n - The count.
 * @param total - The total.
 * @returns "12.5%", or null for an empty total.
 */
function pct(n: number, total: number): string | null {
  return total > 0 ? formatPct((n / total) * 100) : null;
}

/**
 * The figure strip: vehicles and routes running, and how the timed ones split.
 * @param props - Component props.
 * @param props.mode - The mode filter.
 * @returns The strip.
 */
async function LiveFigures({ mode }: { mode: Mode | null }): Promise<JSX.Element> {
  let rows: LiveRouteRow[];
  try {
    rows = await loadRows(mode, null);
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
    { label: "On a run", value: formatCount(t.vehicles) },
    { label: "Routes running", value: formatCount(t.routes) },
    {
      label: "Late",
      value: formatCount(t.late),
      note: pct(t.late, timed),
      tone: "text-at-late",
    },
    {
      label: "On time",
      value: formatCount(t.onTime),
      note: pct(t.onTime, timed),
      tone: "text-at-ontime",
    },
    {
      label: "Early",
      value: formatCount(t.early),
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
 * @param props.sort - The table's sort.
 * @param props.head - Each column heading's link and direction.
 * @param props.keep - The params that keep the sort, for Show all.
 * @param props.all - List every route rather than the first page.
 * @returns The table.
 */
async function LiveTable({
  mode,
  sort,
  head,
  keep,
  all,
}: {
  mode: Mode | null;
  sort: TableSort | null;
  head: (key: string) => { href: string; dir: SortDir | null };
  keep: Record<string, string | undefined>;
  all: boolean;
}): Promise<JSX.Element> {
  let rows: LiveRouteRow[];
  // Slug > directory row, for the line name and for AT's line colour on the icon.
  let routes: Map<string, DirectoryRoute>;
  try {
    const [r, directory] = await Promise.all([
      loadRows(mode, sort),
      getDirectoryRoutes().catch(readFallback("directory-routes", [])),
    ]);
    rows = r;
    routes = new Map(directory.map((d) => [routeSlug(d.routeId), d]));
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
              <SortHeader {...head("route")} align="left">
                Route
              </SortHeader>
              <SortHeader {...head("running")}>Running</SortHeader>
              <SortHeader {...head("late")}>Late</SortHeader>
              <SortHeader {...head("ontime")} className="hidden sm:table-cell">
                On time
              </SortHeader>
              <SortHeader {...head("early")} className="hidden sm:table-cell">
                Early
              </SortHeader>
              <SortHeader {...head("avg")} className="hidden md:table-cell">
                Early or late, avg
              </SortHeader>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const route = routes.get(r.slug);
              const name = route ? (lineName(route.mode, route.shortName) ?? route.longName) : null;
              const avg = offScheduleValue(r.avgDelaySec, null, r.mode);
              return (
                <tr key={r.slug} className="border-b border-at-border last:border-b-0">
                  <th scope="row" className="p-3 text-left font-normal">
                    <Link
                      href={`/route/${encodeURIComponent(r.slug)}`}
                      className="flex min-w-0 items-center gap-2 hover:underline"
                    >
                      <ModeIcon
                        mode={r.mode}
                        shortName={route?.shortName ?? r.slug}
                        longName={route?.longName}
                        colour={route?.colour}
                        className="h-4 w-4 shrink-0"
                      />
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
              ...keep,
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
