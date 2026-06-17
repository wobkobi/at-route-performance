// src/app/route/[id]/page.tsx
import StopMapWrapper from "@/components/StopMapWrapper";
import { cn } from "@/lib/cn";
import { getRouteStats } from "@/lib/data";
import { formatDelay } from "@/lib/format";
import { linkColour } from "@/lib/link-colour";
import { routeStatsQuery } from "@/lib/validate";
import type { JSX } from "react";

/** Query params for route detail (raw strings). */
interface StatsSearchParams {
  from?: string;
  to?: string;
  thresholdSec?: string;
  sort?: string;
}

/**
 * Route detail page: summary + top stops table.
 * @param root0 - Page props.
 * @param root0.params - Promise resolving to the dynamic route params `{ id }`.
 * @param root0.searchParams - Optional query params.
 * @returns Page markup.
 */
export default async function RoutePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<StatsSearchParams>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const parsed = routeStatsQuery.safeParse(sp);
  const query = parsed.success ? parsed.data : routeStatsQuery.parse({});

  const { route, summary, byStop } = await getRouteStats({
    routeId: id,
    from: query.from,
    to: query.to,
    thresholdSec: query.thresholdSec,
  });

  const title = route?.shortName ?? id;
  const colour = linkColour(route?.shortName, route?.longName);

  return (
    <main className={cn("space-y-6")}>
      <header className="space-y-1">
        <h1 className="flex items-center gap-3 text-3xl leading-headline font-ultra tracking-zero">
          {colour && (
            <span
              aria-hidden="true"
              className={cn("inline-block h-4 w-4 shrink-0 rounded-full", colour)}
            />
          )}
          {title}
        </h1>
        {route?.longName && <p className="text-at-muted">{route.longName}</p>}
      </header>

      <section className={cn("grid grid-cols-1 gap-4 sm:grid-cols-3")}>
        <div className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
          <p className="text-sm text-at-muted">Events</p>
          <p className="text-2xl font-semibold tabular-nums">{summary?.events ?? 0}</p>
        </div>
        <div className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
          <p className="text-sm text-at-muted">Avg delay</p>
          <p className="text-2xl font-semibold tabular-nums">
            {summary?.avg_delay_sec == null ? "—" : formatDelay(summary.avg_delay_sec)}
          </p>
        </div>
        <div className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
          <p className="text-sm text-at-muted">On-time (%)</p>
          <p className="text-2xl font-semibold tabular-nums">
            {summary?.on_time_pct?.toFixed(1) ?? "—"}
          </p>
        </div>
      </section>

      {byStop.length > 0 && (
        <section className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Stops &amp; live buses</h2>
            <span className="flex items-center gap-3 text-xs text-at-muted">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-at-late" /> late
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-at-early" /> early
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-at-ontime" /> on time
              </span>
            </span>
          </div>
          <StopMapWrapper stops={byStop} routeId={id} className="h-100 rounded-lg" />
        </section>
      )}

      <section className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
        <h2 className="mb-2 text-lg font-semibold">Top stops</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-at-bg text-at-muted">
              <tr>
                <th className="px-3 py-2 text-left">Stop</th>
                <th className="px-3 py-2 text-right">Events</th>
                <th className="px-3 py-2 text-right">Avg delay</th>
              </tr>
            </thead>
            <tbody>
              {byStop.map((s) => (
                <tr key={s.stop_id} className="border-t border-at-border">
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.events}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.avg_delay_sec == null ? "—" : formatDelay(s.avg_delay_sec)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
